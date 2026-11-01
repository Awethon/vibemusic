import sqlite3InitModule, { type Database, type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { NavidromeHttp } from '../navidrome/http.ts';
import { NavidromeUnreachableError, SessionExpiredError } from '../navidrome/credentials.ts';
import { LIBRARY_STORE, LIBRARY_SYNC } from '../tuning.ts';
import { applyChanges, applyEnrichment, buildLibrary, enrichmentRequest, readMeta, readSyncState, refreshDerived } from './build.ts';
import { SCHEMA_VERSION } from './schema.ts';
import { fetchChanges, fetchLibrary, fetchSnapshotFile } from './fetch.ts';
import type { SyncTimings, WorkerEnvelope, WorkerReply, WorkerRequest, WorkerResults } from './protocol.ts';
import type { LibraryMeta, LibrarySnapshot } from './snapshot.ts';
import { listFiles, readFile, removeFile, writeFile, type Saved } from './store.ts';

let sqlite: Sqlite3Static;
let db: Database | null = null;
let outdated: Database | null = null;
let userId = '';
let chunkSize: number = LIBRARY_STORE.chunkBytes;
let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
let writing: Promise<unknown> = Promise.resolve();
const savedState = new WeakMap<Database, Saved>();

const ready = sqlite3InitModule().then((module) => {
	sqlite = module;
});

const snapshotName = () => `library-${userId}-v${SCHEMA_VERSION}.sqlite`;
const isOutdated = (name: string) => name.startsWith(`library-${userId}-v`) && name !== snapshotName();

async function legacyDirectory(): Promise<FileSystemDirectoryHandle | null> {
	try {
		return (await navigator.storage?.getDirectory?.()) ?? null;
	} catch {
		return null;
	}
}

async function readLegacy(match: (name: string) => boolean): Promise<Uint8Array | null> {
	const directory = await legacyDirectory();
	if (!directory) return null;
	try {
		for await (const [name, handle] of directory.entries()) {
			if (handle.kind === 'file' && match(name)) return new Uint8Array(await (await (handle as FileSystemFileHandle).getFile()).arrayBuffer());
		}
	} catch {
		return null;
	}
	return null;
}

async function removeLegacy() {
	const directory = await legacyDirectory();
	if (!directory) return;
	try {
		for await (const name of directory.keys()) if (name.startsWith(`library-${userId}`)) await directory.removeEntry(name);
	} catch {
		return;
	}
}

function liveBytes(database: Database): Uint8Array {
	const { capi, wasm } = sqlite;
	const sizeOut = wasm.alloc(8);
	try {
		const pointer = capi.sqlite3_serialize(database.pointer!, 'main', sizeOut, capi.SQLITE_SERIALIZE_NOCOPY);
		if (pointer) return wasm.heap8u().subarray(pointer, pointer + Number(wasm.peek(sizeOut, 'i64')));
	} finally {
		wasm.dealloc(sizeOut);
	}
	return capi.sqlite3_js_db_export(database);
}

function writeSnapshot(database: Database): Promise<number> {
	const next = writing.then(async () => {
		const result = await writeFile(snapshotName(), () => liveBytes(database), chunkSize, savedState.get(database) ?? null);
		savedState.set(database, result.saved);
		return result.size;
	});
	writing = next.catch(() => {});
	return next;
}

function emptyDatabase(): Database {
	const database = new sqlite.oo1.DB();
	const flags = sqlite.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite.capi.SQLITE_DESERIALIZE_RESIZEABLE;
	database.checkRc(sqlite.capi.sqlite3_deserialize(database.pointer!, 'main', 0, 0, 0, flags));
	return database;
}

function databaseFrom(bytes: Uint8Array): Database {
	const database = new sqlite.oo1.DB();
	const pointer = sqlite.wasm.allocFromTypedArray(bytes);
	const flags = sqlite.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite.capi.SQLITE_DESERIALIZE_RESIZEABLE;
	database.checkRc(sqlite.capi.sqlite3_deserialize(database.pointer!, 'main', pointer, bytes.byteLength, bytes.byteLength, flags));
	return database;
}

async function loadOutdatedSnapshot(): Promise<Database | null> {
	try {
		const name = (await listFiles()).find(isOutdated);
		const stored = name ? await readFile(name) : null;
		if (stored) return databaseFrom(stored.bytes);
	} catch {
		return null;
	}
	const legacy = await readLegacy(isOutdated);
	return legacy && databaseFrom(legacy);
}

async function removeOutdatedSnapshots() {
	try {
		for (const name of await listFiles()) if (isOutdated(name)) await removeFile(name);
	} catch {
		return;
	}
}

function replaceDatabase(next: Database | null) {
	const previous = db;
	db = next;
	previous?.close();
}

async function loadSnapshot() {
	const stored = await readFile(snapshotName()).catch(() => null);
	const legacy = stored ? null : await readLegacy((name) => name === snapshotName());
	const bytes = stored?.bytes ?? legacy;
	if (!bytes) return null;
	try {
		const database = databaseFrom(bytes);
		const meta = readMeta(database);
		if (!meta || meta.userId !== userId) {
			database.close();
			return null;
		}
		if (stored) savedState.set(database, stored.saved);
		replaceDatabase(database);
		const refreshed = refreshDerived(database, meta);
		if (refreshed || legacy) await writeSnapshot(database);
		if (legacy) void removeLegacy();
		return refreshed ?? meta;
	} catch {
		return null;
	}
}

function scheduleSnapshotWrite() {
	clearTimeout(snapshotTimer);
	snapshotTimer = setTimeout(() => {
		if (db) void writeSnapshot(db);
	}, LIBRARY_SYNC.snapshotWriteDelayMs);
}

async function install(snapshot: LibrarySnapshot, fetchMs: number): Promise<{ meta: LibraryMeta; timings: SyncTimings }> {
	const buildStarted = performance.now();
	const database = emptyDatabase();
	const meta = buildLibrary(database, snapshot, userId, new Date().toISOString(), db ?? outdated);
	replaceDatabase(database);
	if (outdated) {
		outdated.close();
		outdated = null;
		void removeOutdatedSnapshots();
		void removeLegacy();
	}
	const writeStarted = performance.now();
	const snapshotBytes = await writeSnapshot(database);
	return { meta, timings: { fetchMs, buildMs: writeStarted - buildStarted, writeMs: performance.now() - writeStarted, snapshotBytes, steps: snapshot.steps ?? {} } };
}

async function syncChanges(http: NavidromeHttp, albumIds: string[]): Promise<{ meta: LibraryMeta; changed: boolean } | null> {
	const meta = db && readMeta(db);
	const sync = db && readSyncState(db);
	if (!meta || !sync || Date.now() - Date.parse(sync.fullSyncAt) > LIBRARY_SYNC.fullSyncIntervalMs) return null;
	const changes = await fetchChanges(http, sync, meta.albums, albumIds);
	if (!changes || !db) return null;
	const result = applyChanges(db, meta, sync, changes, new Date().toISOString());
	if (changes.totals && (changes.totals.albums !== result.meta.albums || changes.totals.tracks !== result.meta.tracks)) return null;
	if (result.changed) await writeSnapshot(db);
	return result;
}

function requireDatabase(): Database {
	if (!db) throw new Error('Library not loaded');
	return db;
}

async function handle(id: number, request: WorkerRequest): Promise<WorkerResults[keyof WorkerResults]> {
	await ready;
	switch (request.kind) {
		case 'open': {
			userId = request.userId;
			chunkSize = request.chunkBytes ?? LIBRARY_STORE.chunkBytes;
			const meta = await loadSnapshot();
			if (meta) void removeOutdatedSnapshots();
			else outdated = await loadOutdatedSnapshot();
			return meta;
		}
		case 'reload':
			return loadSnapshot();
		case 'sync': {
			let token = request.credentials.token;
			const http = new NavidromeHttp(request.credentials, (renewed) => (token = renewed));
			const incremental = request.full ? null : await syncChanges(http, request.albumIds);
			if (incremental) return { ...incremental, token, timings: null };
			const started = performance.now();
			const snapshot = await fetchLibrary(http, (progress) => self.postMessage({ id, progress } satisfies WorkerReply));
			return { ...(await install(snapshot, performance.now() - started)), token, changed: true };
		}
		case 'loadFile': {
			const started = performance.now();
			const snapshot = await fetchSnapshotFile(request.url);
			return install(snapshot, performance.now() - started);
		}
		case 'query': {
			const columns: string[] = [];
			const rows = requireDatabase().exec({ sql: request.sql, bind: request.params, rowMode: 'array', returnValue: 'resultRows', columnNames: columns });
			return { columns, rows } as WorkerResults['query'];
		}
		case 'persist':
			return writeSnapshot(requireDatabase());
		case 'enrichmentRequest':
			return enrichmentRequest(requireDatabase());
		case 'enrich': {
			const database = requireDatabase();
			const meta = readMeta(database);
			const sync = readSyncState(database);
			if (!meta || !sync) throw new Error('Library not loaded');
			const next = applyEnrichment(database, meta, sync, request.enrichment);
			await writeSnapshot(database);
			return next;
		}
		case 'run': {
			const database = requireDatabase();
			database.exec({ sql: request.sql, bind: request.params });
			if (request.persist) scheduleSnapshotWrite();
			return database.changes();
		}
	}
}

self.addEventListener('message', async (event: MessageEvent<WorkerEnvelope>) => {
	const { id, request } = event.data;
	let reply: WorkerReply;
	try {
		reply = { id, ok: true, value: await handle(id, request) };
	} catch (error) {
		reply = { id, ok: false, error: error instanceof Error ? error.message : String(error), expired: error instanceof SessionExpiredError, unreachable: error instanceof NavidromeUnreachableError };
	}
	self.postMessage(reply);
});
