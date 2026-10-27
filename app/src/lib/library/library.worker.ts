import sqlite3InitModule, { type Database, type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { NavidromeHttp } from '../navidrome/http.ts';
import { NavidromeUnreachableError, SessionExpiredError } from '../navidrome/credentials.ts';
import { LIBRARY_SYNC } from '../tuning.ts';
import { applyChanges, buildLibrary, readMeta, readSyncState } from './build.ts';
import { SCHEMA_VERSION } from './schema.ts';
import { fetchChanges, fetchLibrary, fetchSnapshotFile } from './fetch.ts';
import type { SyncTimings, WorkerEnvelope, WorkerReply, WorkerRequest, WorkerResults } from './protocol.ts';
import type { LibraryMeta, LibrarySnapshot } from './snapshot.ts';

let sqlite: Sqlite3Static;
let db: Database | null = null;
let userId = '';
let snapshotTimer: ReturnType<typeof setTimeout> | undefined;

const ready = sqlite3InitModule().then((module) => {
	sqlite = module;
});

const snapshotName = () => `library-${userId}-v${SCHEMA_VERSION}.sqlite`;

async function readSnapshot(): Promise<Uint8Array | null> {
	try {
		const directory = await navigator.storage.getDirectory();
		const file = await directory.getFileHandle(snapshotName());
		return new Uint8Array(await (await file.getFile()).arrayBuffer());
	} catch {
		return null;
	}
}

async function writeSnapshot(database: Database) {
	const bytes = sqlite.capi.sqlite3_js_db_export(database);
	await writeBytes(bytes);
	return bytes.byteLength;
}

type SyncAccessHandle = { truncate(size: number): void; write(buffer: Uint8Array, options: { at: number }): number; flush(): void; close(): void };
type WorkerFileHandle = Omit<FileSystemFileHandle, 'createWritable'> & { createWritable?: FileSystemFileHandle['createWritable']; createSyncAccessHandle?(): Promise<SyncAccessHandle> };

async function writeBytes(bytes: Uint8Array<ArrayBuffer>) {
	const directory = await navigator.storage.getDirectory();
	const file: WorkerFileHandle = await directory.getFileHandle(snapshotName(), { create: true });
	if (file.createWritable) {
		const writable = await file.createWritable();
		await writable.write(bytes);
		await writable.close();
		return;
	}
	if (!file.createSyncAccessHandle) throw new Error('This browser cannot save the library');
	const access = await file.createSyncAccessHandle();
	try {
		access.truncate(0);
		access.write(bytes, { at: 0 });
		access.flush();
	} finally {
		access.close();
	}
}

async function removeOutdatedSnapshots() {
	try {
		const directory = await navigator.storage.getDirectory();
		for await (const name of directory.keys()) {
			if (name.startsWith(`library-${userId}`) && name !== snapshotName()) await directory.removeEntry(name);
		}
	} catch {
		return;
	}
}

function databaseFrom(bytes: Uint8Array): Database {
	const database = new sqlite.oo1.DB();
	const pointer = sqlite.wasm.allocFromTypedArray(bytes);
	const flags = sqlite.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite.capi.SQLITE_DESERIALIZE_RESIZEABLE;
	database.checkRc(sqlite.capi.sqlite3_deserialize(database.pointer!, 'main', pointer, bytes.byteLength, bytes.byteLength, flags));
	return database;
}

function replaceDatabase(next: Database | null) {
	const previous = db;
	db = next;
	previous?.close();
}

function carryPalettes(from: Database | null, to: Database) {
	if (!from) return;
	const rows = from.selectArrays('select album_id, colors from palette');
	const insert = to.prepare('insert or ignore into palette values (?, ?)');
	to.transaction(() => rows.forEach((row) => insert.bind(row as [string, string]).stepReset()));
	insert.finalize();
}

async function loadSnapshot() {
	const bytes = await readSnapshot();
	if (!bytes) return null;
	try {
		const database = databaseFrom(bytes);
		const meta = readMeta(database);
		if (!meta || meta.userId !== userId) {
			database.close();
			return null;
		}
		replaceDatabase(database);
		return meta;
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
	const database = new sqlite.oo1.DB();
	const meta = buildLibrary(database, snapshot, userId, new Date().toISOString());
	carryPalettes(db, database);
	replaceDatabase(database);
	const writeStarted = performance.now();
	const snapshotBytes = await writeSnapshot(database);
	return { meta, timings: { fetchMs, buildMs: writeStarted - buildStarted, writeMs: performance.now() - writeStarted, snapshotBytes, steps: snapshot.steps ?? {} } };
}

async function syncChanges(http: NavidromeHttp): Promise<{ meta: LibraryMeta; changed: boolean } | null> {
	const meta = db && readMeta(db);
	const sync = db && readSyncState(db);
	if (!meta || !sync || Date.now() - Date.parse(sync.fullSyncAt) > LIBRARY_SYNC.fullSyncIntervalMs) return null;
	const changes = await fetchChanges(http, sync, meta.albums);
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
		case 'open':
			userId = request.userId;
			void removeOutdatedSnapshots();
			return loadSnapshot();
		case 'reload':
			return loadSnapshot();
		case 'sync': {
			let token = request.credentials.token;
			const http = new NavidromeHttp(request.credentials, (renewed) => (token = renewed));
			const incremental = request.full ? null : await syncChanges(http);
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
