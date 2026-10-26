import sqlite3InitModule, { type Database, type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { NavidromeHttp } from '../navidrome/http.ts';
import { SessionExpiredError } from '../navidrome/credentials.ts';
import { LIBRARY_SYNC } from '../tuning.ts';
import { buildLibrary, readMeta } from './build.ts';
import { fetchLibrary } from './fetch.ts';
import type { WorkerEnvelope, WorkerReply, WorkerRequest, WorkerResults } from './protocol.ts';

let sqlite: Sqlite3Static;
let db: Database | null = null;
let userId = '';
let snapshotTimer: ReturnType<typeof setTimeout> | undefined;

const ready = sqlite3InitModule().then((module) => {
	sqlite = module;
});

const snapshotName = () => `library-${userId}.sqlite`;

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
	const directory = await navigator.storage.getDirectory();
	const file = await directory.getFileHandle(snapshotName(), { create: true });
	const writable = await file.createWritable();
	await writable.write(bytes);
	await writable.close();
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

function requireDatabase(): Database {
	if (!db) throw new Error('Library not loaded');
	return db;
}

async function handle(request: WorkerRequest): Promise<WorkerResults[keyof WorkerResults]> {
	await ready;
	switch (request.kind) {
		case 'open':
			userId = request.userId;
			return loadSnapshot();
		case 'reload':
			return loadSnapshot();
		case 'sync': {
			let token = request.credentials.token;
			const http = new NavidromeHttp(request.credentials, (renewed) => (token = renewed));
			const snapshot = await fetchLibrary(http);
			const database = new sqlite.oo1.DB();
			const meta = buildLibrary(database, snapshot, userId, new Date().toISOString());
			carryPalettes(db, database);
			replaceDatabase(database);
			await writeSnapshot(database);
			return { meta, token };
		}
		case 'query':
			return requireDatabase().selectObjects(request.sql, request.params) as WorkerResults['query'];
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
		reply = { id, ok: true, value: await handle(request) };
	} catch (error) {
		reply = { id, ok: false, error: error instanceof Error ? error.message : String(error), expired: error instanceof SessionExpiredError };
	}
	self.postMessage(reply);
});
