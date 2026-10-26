import { onReconnect, reportReachable, reportUnreachable } from '../connection.svelte.ts';
import { NavidromeUnreachableError, SessionExpiredError } from '../navidrome/credentials.ts';
import { navidrome, renewToken, requireCredentials, sessionExpired } from '../session.svelte.ts';
import { LIBRARY_SYNC } from '../tuning.ts';
import { fetchLibraryVersion } from './fetch.ts';
import LibraryWorker from './library.worker.ts?worker';
import type { SqlParam, SyncProgress, SyncTimings, WorkerEnvelope, WorkerReply, WorkerRequest, WorkerResults } from './protocol.ts';
import { coverAlbumOverrides } from '../navidrome/credentials.ts';
import { SCHEMA_VERSION } from './schema.ts';
import type { LibraryMeta } from './snapshot.ts';

type Status = 'idle' | 'loading' | 'syncing' | 'ready' | 'error';

type ChannelMessage = { kind: 'snapshot'; version: string } | { kind: 'patch'; sql: string; params: SqlParam[] } | { kind: 'resync' } | { kind: 'need-snapshot' };

export const library = $state<{ status: Status; meta: LibraryMeta | null; revision: number; leader: boolean; error: string; openMs: number; timings: SyncTimings | null; progress: SyncProgress | null }>({
	status: 'idle',
	meta: null,
	revision: 0,
	leader: false,
	error: '',
	openMs: 0,
	timings: null,
	progress: null
});

const SYNTHETIC_LIBRARY = { version: 'synthetic-1', snapshotUrl: '/dev/library-large.json', coversUrl: '/dev/library-large-covers.json' };
const syntheticLibrary = import.meta.env.DEV && new URLSearchParams(location.search).get('lib') === 'synthetic';

let worker: Worker | null = null;
let channel: BroadcastChannel | null = null;
let nextRequestId = 0;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
let syncing: Promise<void> | null = null;

function call<K extends WorkerRequest['kind']>(request: Extract<WorkerRequest, { kind: K }>): Promise<WorkerResults[K]> {
	if (!worker) return Promise.reject(new Error('Library not started'));
	const id = ++nextRequestId;
	const envelope: WorkerEnvelope = { id, request };
	return new Promise((resolve, reject) => {
		pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
		worker!.postMessage(envelope);
	});
}

function onWorkerReply(event: MessageEvent<WorkerReply>) {
	const reply = event.data;
	if ('progress' in reply) {
		library.progress = reply.progress;
		return;
	}
	const waiter = pending.get(reply.id);
	if (!waiter) return;
	pending.delete(reply.id);
	if (reply.ok) waiter.resolve(reply.value);
	else waiter.reject(reply.expired ? new SessionExpiredError() : reply.unreachable ? new NavidromeUnreachableError() : new Error(reply.error));
}

function loaded(meta: LibraryMeta | null) {
	if (!meta) return;
	library.meta = meta;
	library.status = 'ready';
	library.revision += 1;
}

function failed(error: unknown) {
	if (error instanceof SessionExpiredError) {
		sessionExpired();
		return;
	}
	if (error instanceof NavidromeUnreachableError) reportUnreachable();
	library.progress = null;
	library.error = error instanceof Error ? error.message : String(error);
	if (!library.meta) library.status = 'error';
}

async function syncNow() {
	if (!library.meta) library.status = 'syncing';
	const result = await call({ kind: 'sync', credentials: $state.snapshot(requireCredentials()) });
	reportReachable();
	renewToken(result.token);
	library.timings = result.timings;
	library.progress = null;
	loaded(result.meta);
	channel?.postMessage({ kind: 'snapshot', version: result.meta.version } satisfies ChannelMessage);
}

async function checkForChanges(force = false) {
	if (syncing) return syncing;
	syncing = (async () => {
		try {
			const version = await fetchLibraryVersion(navidrome());
			if (force || !library.meta || library.meta.version !== version) await syncNow();
			library.error = '';
		} catch (error) {
			failed(error);
		} finally {
			syncing = null;
		}
	})();
	return syncing;
}

onReconnect(() => {
	if (library.leader) void checkForChanges();
});

function lead() {
	library.leader = true;
	void checkForChanges();
	setInterval(() => void checkForChanges(), LIBRARY_SYNC.pollIntervalMs);
}

async function onChannelMessage(event: MessageEvent<ChannelMessage>) {
	const message = event.data;
	if (message.kind === 'snapshot') {
		if (library.meta?.version === message.version && library.status === 'ready') return;
		try {
			loaded(await call({ kind: 'reload' }));
		} catch (error) {
			failed(error);
		}
	} else if (message.kind === 'resync') {
		if (library.leader) await checkForChanges(true);
	} else if (message.kind === 'need-snapshot') {
		if (!library.leader || !library.meta) return;
		await call({ kind: 'persist' });
		channel?.postMessage({ kind: 'snapshot', version: library.meta.version } satisfies ChannelMessage);
	} else {
		await call({ kind: 'run', sql: message.sql, params: message.params, persist: library.leader });
		library.revision += 1;
	}
}

async function startSyntheticLibrary() {
	const covers = (await (await fetch(SYNTHETIC_LIBRARY.coversUrl)).json()) as Record<string, string>;
	for (const [albumId, coverAlbumId] of Object.entries(covers)) coverAlbumOverrides.set(albumId, coverAlbumId);
	if (library.meta?.version === SYNTHETIC_LIBRARY.version) return;
	library.status = 'syncing';
	const result = await call({ kind: 'loadFile', url: SYNTHETIC_LIBRARY.snapshotUrl });
	library.timings = result.timings;
	loaded(result.meta);
}

export async function startLibrary() {
	if (worker) return;
	const userId = syntheticLibrary ? 'synthetic' : requireCredentials().userId;
	library.status = 'loading';
	worker = new LibraryWorker();
	worker.addEventListener('message', onWorkerReply);
	channel = new BroadcastChannel(`vibemusic-library-${userId}-v${SCHEMA_VERSION}`);
	channel.addEventListener('message', onChannelMessage);
	try {
		const openStarted = performance.now();
		loaded(await call({ kind: 'open', userId }));
		library.openMs = performance.now() - openStarted;
		if (syntheticLibrary) {
			await startSyntheticLibrary();
			return;
		}
		if (!library.meta) {
			library.status = 'syncing';
			channel.postMessage({ kind: 'need-snapshot' } satisfies ChannelMessage);
		}
	} catch (error) {
		failed(error);
	}
	void navigator.storage.persist?.();
	void navigator.locks.request(`vibemusic-library-leader-${userId}-v${SCHEMA_VERSION}`, () => {
		lead();
		return new Promise(() => {});
	});
}

export async function resyncLibrary() {
	if (library.leader) await checkForChanges(true);
	else channel?.postMessage({ kind: 'resync' } satisfies ChannelMessage);
}

export async function query<Row>(sql: string, params: SqlParam[] = []): Promise<Row[]> {
	const { columns, rows } = await call({ kind: 'query', sql, params });
	return rows.map((row) => {
		const record: Record<string, SqlParam> = {};
		for (let index = 0; index < columns.length; index++) record[columns[index]] = row[index];
		return record as Row;
	});
}

export async function patchLibrary(sql: string, params: SqlParam[]) {
	await call({ kind: 'run', sql, params, persist: library.leader });
	channel?.postMessage({ kind: 'patch', sql, params } satisfies ChannelMessage);
	library.revision += 1;
}
