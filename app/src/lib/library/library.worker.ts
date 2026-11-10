// Web Worker that owns the library: an in-memory SQLite (WASM) database, its sync from Navidrome
// and its saves to IndexedDB. Every tab runs one; only the leader tab asks it to sync and save,
// other tabs reload what the leader saved. The main-thread side is library.svelte.ts.

import sqlite3InitModule, { type Database, type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { NavidromeHttp } from '../navidrome/http.ts';
import { NavidromeUnreachableError, SessionExpiredError } from '../navidrome/credentials.ts';
import { LIBRARY_STORE, LIBRARY_SYNC } from '../tuning.ts';
import {
	applyChanges,
	applyEnrichment,
	buildLibrary,
	configureGenrePlaylists,
	enrichmentRequest,
	readMeta,
	readSyncState,
	refreshDerived
} from './build.ts';
import type { GenrePlaylistConfig } from '../serverConfig.ts';
import { SCHEMA_VERSION } from './schema.ts';
import { fetchChanges, fetchLibrary } from './fetch.ts';
import type { SyncTimings, WorkerEnvelope, WorkerReply, WorkerRequest, WorkerResults } from './protocol.ts';
import type { LibraryMeta, LibrarySnapshot } from './snapshot.ts';
import { listFiles, readFile, removeFile, writeFile } from './store.ts';

let sqlite: Sqlite3Static;
let db: Database | null = null;
// A database saved under an older SCHEMA_VERSION, kept until the next full build so that build can
// carry over data that is expensive to fetch again (enrichment, palettes; see KEPT_TABLES).
let outdated: Database | null = null;
let userId = '';
let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
// Saves run one at a time; each waits for the previous one.
let writing: Promise<unknown> = Promise.resolve();

// The page sends the instance config (/config.json) as its first request; nothing else runs before it.
let configure: (config: GenrePlaylistConfig) => void = () => {};
const configured = new Promise<void>((resolve) => {
	configure = (config) => {
		configureGenrePlaylists(config);
		resolve();
	};
});

const ready = Promise.all([
	sqlite3InitModule().then((module) => {
		sqlite = module;
	}),
	configured
]);

// The schema version is part of the name, so a new app version never reads an incompatible file.
const snapshotName = () => `library-${userId}-v${SCHEMA_VERSION}.sqlite`;
const isOutdated = (name: string) => name.startsWith(`library-${userId}-v`) && name !== snapshotName();

// Older versions saved the database as one file in OPFS. These "legacy" helpers read it once,
// migrate it to IndexedDB and delete it.
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
			if (handle.kind === 'file' && match(name))
				return new Uint8Array(await (await (handle as FileSystemFileHandle).getFile()).arrayBuffer());
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

// The database's bytes without copying them (NOCOPY returns a view of WASM memory). This only works
// for databases created by sqlite3_deserialize, which is why emptyDatabase() and databaseFrom() use
// it; otherwise it falls back to a full export. The view is only valid until the database changes.
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
		const result = await writeFile(snapshotName(), () => liveBytes(database), LIBRARY_STORE.chunkBytes);
		return result.size;
	});
	// A failed save must not block the ones after it.
	writing = next.catch(() => {});
	return next;
}

// Deserializing an empty buffer instead of opening a plain :memory: database, so liveBytes can use
// SQLITE_SERIALIZE_NOCOPY on it.
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
		if (stored) return databaseFrom(stored);
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
	const bytes = stored ?? legacy;
	if (!bytes) return null;
	try {
		const database = databaseFrom(bytes);
		const meta = readMeta(database);
		// readMeta returns null for another schema version.
		if (!meta || meta.userId !== userId) {
			database.close();
			return null;
		}
		replaceDatabase(database);
		// Genre/playlist rules may have changed since this file was saved (see derivedRules() in build.ts).
		// That refresh stays in memory here: every tab loads snapshots, but only the leader saves
		// (it saves once when it starts leading, see lead() in library.svelte.ts).
		const refreshed = refreshDerived(database, meta);
		if (legacy) {
			await writeSnapshot(database);
			void removeLegacy();
		}
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
	// Built into a fresh database and swapped in afterwards, so queries keep working during the build.
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
	return {
		meta,
		timings: {
			fetchMs,
			buildMs: writeStarted - buildStarted,
			writeMs: performance.now() - writeStarted,
			snapshotBytes,
			steps: snapshot.steps ?? {}
		}
	};
}

async function syncChanges(
	http: NavidromeHttp,
	albumIds: string[],
	artistIds: string[]
): Promise<{ meta: LibraryMeta; changed: boolean } | null> {
	const meta = db && readMeta(db);
	const sync = db && readSyncState(db);
	// null means "do a full sync instead": no local data, the last full sync is too old, too many
	// changes, or the totals disagree afterwards (the incremental path missed something).
	if (!meta || !sync || Date.now() - Date.parse(sync.fullSyncAt) > LIBRARY_SYNC.fullSyncIntervalMs) return null;
	const changes = await fetchChanges(http, sync, meta.albums, albumIds, artistIds);
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
	if (request.kind === 'configure') {
		configure(request.genrePlaylists);
		return null;
	}
	await ready;
	switch (request.kind) {
		case 'open': {
			userId = request.userId;
			const meta = await loadSnapshot();
			if (meta) void removeOutdatedSnapshots();
			// No current file: keep the outdated one in memory for the first full build to carry from.
			else outdated = await loadOutdatedSnapshot();
			return meta;
		}
		// Another tab (the leader) saved a newer snapshot.
		case 'reload':
			return loadSnapshot();
		case 'sync': {
			let token = request.credentials.token;
			const http = new NavidromeHttp(request.credentials, (renewed) => (token = renewed));
			const incremental = request.full ? null : await syncChanges(http, request.albumIds, request.artistIds);
			if (incremental) return { ...incremental, token, timings: null };
			const started = performance.now();
			const snapshot = await fetchLibrary(http, (progress) => self.postMessage({ id, progress } satisfies WorkerReply));
			return { ...(await install(snapshot, performance.now() - started)), token, changed: true };
		}
		case 'query': {
			const columns: string[] = [];
			const rows = requireDatabase().exec({
				sql: request.sql,
				bind: request.params,
				rowMode: 'array',
				returnValue: 'resultRows',
				columnNames: columns
			});
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
			// Local edits (stars, plays, palettes) are batched into one save shortly after.
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
		reply = {
			id,
			ok: false,
			error: error instanceof Error ? error.message : String(error),
			expired: error instanceof SessionExpiredError,
			unreachable: error instanceof NavidromeUnreachableError
		};
	}
	self.postMessage(reply);
});
