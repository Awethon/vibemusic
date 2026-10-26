import { SessionExpiredError } from '../navidrome/credentials.ts';
import { navidrome, renewToken, requireCredentials, sessionExpired } from '../session.svelte.ts';
import { LIBRARY_SYNC } from '../tuning.ts';
import { fetchLibraryVersion } from './fetch.ts';
import LibraryWorker from './library.worker.ts?worker';
import type { SqlParam, WorkerEnvelope, WorkerReply, WorkerRequest, WorkerResults } from './protocol.ts';
import type { LibraryMeta } from './snapshot.ts';

type Status = 'idle' | 'loading' | 'syncing' | 'ready' | 'error';

type ChannelMessage = { kind: 'snapshot'; version: string } | { kind: 'patch'; sql: string; params: SqlParam[] } | { kind: 'resync' };

export const library = $state<{ status: Status; meta: LibraryMeta | null; revision: number; leader: boolean; error: string }>({
	status: 'idle',
	meta: null,
	revision: 0,
	leader: false,
	error: ''
});

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
	const waiter = pending.get(reply.id);
	if (!waiter) return;
	pending.delete(reply.id);
	if (reply.ok) waiter.resolve(reply.value);
	else waiter.reject(reply.expired ? new SessionExpiredError() : new Error(reply.error));
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
	library.error = error instanceof Error ? error.message : String(error);
	if (!library.meta) library.status = 'error';
}

async function syncNow() {
	if (!library.meta) library.status = 'syncing';
	const result = await call({ kind: 'sync', credentials: requireCredentials() });
	renewToken(result.token);
	loaded(result.meta);
	channel?.postMessage({ kind: 'snapshot', version: result.meta.version } satisfies ChannelMessage);
}

async function checkForChanges(force = false) {
	if (syncing) return syncing;
	syncing = (async () => {
		try {
			const version = await fetchLibraryVersion(navidrome());
			if (force || !library.meta || library.meta.version !== version) await syncNow();
		} catch (error) {
			failed(error);
		} finally {
			syncing = null;
		}
	})();
	return syncing;
}

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
	} else {
		await call({ kind: 'run', sql: message.sql, params: message.params, persist: library.leader });
		library.revision += 1;
	}
}

export async function startLibrary() {
	if (worker) return;
	const { userId } = requireCredentials();
	library.status = 'loading';
	worker = new LibraryWorker();
	worker.onmessage = onWorkerReply;
	channel = new BroadcastChannel(`vibemusic-library-${userId}`);
	channel.onmessage = onChannelMessage;
	try {
		loaded(await call({ kind: 'open', userId }));
		if (!library.meta) library.status = 'syncing';
	} catch (error) {
		failed(error);
	}
	void navigator.storage.persist?.();
	void navigator.locks.request(`vibemusic-library-leader-${userId}`, () => {
		lead();
		return new Promise(() => {});
	});
}

export async function resyncLibrary() {
	if (library.leader) await checkForChanges(true);
	else channel?.postMessage({ kind: 'resync' } satisfies ChannelMessage);
}

export function query<Row>(sql: string, params: SqlParam[] = []): Promise<Row[]> {
	return call({ kind: 'query', sql, params }) as Promise<Row[]>;
}

export async function patchLibrary(sql: string, params: SqlParam[]) {
	await call({ kind: 'run', sql, params, persist: library.leader });
	channel?.postMessage({ kind: 'patch', sql, params } satisfies ChannelMessage);
	library.revision += 1;
}
