import { onReconnect, reportReachable, reportUnreachable } from '../connection.svelte.ts';
import { NavidromeUnreachableError, SessionExpiredError } from '../navidrome/credentials.ts';
import { renewToken, requireCredentials, sessionExpired } from '../session.svelte.ts';
import { listenToRelay, relay, sendToRelay } from '../remote/relay.svelte.ts';
import { ENRICHMENT, LIBRARY_SYNC } from '../tuning.ts';
import LibraryWorker from './library.worker.ts?worker';
import type { SqlParam, SyncProgress, SyncTimings, WorkerEnvelope, WorkerReply, WorkerRequest, WorkerResults } from './protocol.ts';
import { albumArt, artistArt, coverAlbumOverrides } from '../navidrome/credentials.ts';
import { listenToNavidrome, type RefreshedIds } from '../navidrome/events.ts';
import { leadWhenFree } from './lease.ts';
import { SCHEMA_VERSION } from './schema.ts';
import type { Enrichment, LibraryMeta } from './snapshot.ts';

type Status = 'idle' | 'loading' | 'syncing' | 'ready' | 'error';

type ChannelMessage = { kind: 'snapshot'; version: string } | { kind: 'patch'; sql: string; params: SqlParam[] } | { kind: 'resync'; full: boolean } | { kind: 'need-snapshot' };

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

const SYNTHETIC_LIBRARY = { snapshotUrl: '/dev/library-large.json', coversUrl: '/dev/library-large-covers.json' };
const syntheticLibrary = import.meta.env.DEV && new URLSearchParams(location.search).get('lib') === 'synthetic';
const devChunkBytes = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('chunkKb')) * 1024 || undefined : undefined;

let worker: Worker | null = null;
let channel: BroadcastChannel | null = null;
let nextRequestId = 0;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
let syncing: Promise<void> | null = null;
let lastSyncAt = 0;
let eventsLive = false;
let eventTimer: ReturnType<typeof setTimeout> | undefined;
const refreshedAlbums = new Set<string>();
const refreshedArtists = new Set<string>();

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

async function refreshCoverStamps() {
	const [albums, artists] = await Promise.all([
		query<{ id: string; image_hash: string; dominant_color: string; thumb_hash: string }>("select id, image_hash, dominant_color, thumb_hash from album where image_hash != '' or dominant_color != '' or thumb_hash != ''"),
		query<{ artist_id: string; dominant_color: string; thumb_hash: string }>("select artist_id, dominant_color, thumb_hash from artist_art where thumb_hash != '' or dominant_color != ''")
	]);
	for (const { id, image_hash: hash, dominant_color: color, thumb_hash: thumb } of albums) {
		const known = albumArt.get(id);
		if (known?.hash !== hash || known.color !== color || known.thumb !== thumb) albumArt.set(id, { hash, color, thumb });
	}
	for (const { artist_id: id, dominant_color: color, thumb_hash: thumb } of artists) {
		const known = artistArt.get(id);
		if (known?.color !== color || known.thumb !== thumb) artistArt.set(id, { color, thumb });
	}
}

async function loaded(meta: LibraryMeta | null) {
	if (!meta) return;
	await refreshCoverStamps();
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

async function syncNow(full: boolean) {
	if (!library.meta) library.status = 'syncing';
	const albumIds = [...refreshedAlbums];
	const artistIds = [...refreshedArtists];
	refreshedAlbums.clear();
	refreshedArtists.clear();
	let result: WorkerResults['sync'];
	try {
		result = await call({ kind: 'sync', credentials: $state.snapshot(requireCredentials()), full, albumIds, artistIds });
	} catch (error) {
		for (const id of albumIds) refreshedAlbums.add(id);
		for (const id of artistIds) refreshedArtists.add(id);
		throw error;
	}
	lastSyncAt = Date.now();
	reportReachable();
	renewToken(result.token);
	library.progress = null;
	if (result.timings) library.timings = result.timings;
	if (!result.changed) {
		library.meta = result.meta;
		return;
	}
	await loaded(result.meta);
	channel?.postMessage({ kind: 'snapshot', version: result.meta.version } satisfies ChannelMessage);
	void requestEnrichment(true);
}

let pendingEnrichment: Enrichment | null = null;
let enrichmentTimer: ReturnType<typeof setTimeout> | undefined;
let lastEnrichmentAt = 0;
let lastEnrichmentRequestAt = 0;

async function requestEnrichment(force = false) {
	if (!library.leader || !relay.connected || !library.meta || syntheticLibrary) return;
	if (!force && Date.now() - lastEnrichmentRequestAt < ENRICHMENT.requestIntervalMs) return;
	lastEnrichmentRequestAt = Date.now();
	try {
		sendToRelay({ type: 'enrich', ...(await call({ kind: 'enrichmentRequest' })) });
	} catch {
		lastEnrichmentRequestAt = 0;
	}
}

function queueEnrichment(enrichment: Enrichment) {
	if ([enrichment.releaseGroups, enrichment.mbArtists, enrichment.deezer, enrichment.artistMatches ?? {}, enrichment.apple ?? {}].every((part) => !Object.keys(part).length)) return;
	pendingEnrichment = pendingEnrichment
		? {
				at: Math.max(pendingEnrichment.at, enrichment.at),
				releaseGroups: { ...pendingEnrichment.releaseGroups, ...enrichment.releaseGroups },
				mbArtists: { ...pendingEnrichment.mbArtists, ...enrichment.mbArtists },
				deezer: { ...pendingEnrichment.deezer, ...enrichment.deezer },
				artistMatches: { ...pendingEnrichment.artistMatches, ...enrichment.artistMatches },
				apple: { ...pendingEnrichment.apple, ...enrichment.apple }
			}
		: enrichment;
	if (enrichmentTimer) return;
	enrichmentTimer = setTimeout(applyEnrichment, Math.max(ENRICHMENT.applyDelayMs, lastEnrichmentAt + ENRICHMENT.applyIntervalMs - Date.now()));
}

async function applyEnrichment() {
	enrichmentTimer = undefined;
	const enrichment = pendingEnrichment;
	pendingEnrichment = null;
	if (!enrichment || !library.meta) return;
	lastEnrichmentAt = Date.now();
	try {
		const meta = await call({ kind: 'enrich', enrichment });
		await loaded(meta);
		channel?.postMessage({ kind: 'snapshot', version: meta.version } satisfies ChannelMessage);
	} catch (error) {
		console.warn('Could not apply genre and popularity data', error);
	}
}

listenToRelay((message) => {
	if (message.type === 'welcome') void requestEnrichment(true);
	if (message.type === 'enrichment' && library.leader) {
		const { type: _, ...enrichment } = message;
		queueEnrichment(enrichment);
	}
});

async function checkForChanges(full = false) {
	if (syncing) return syncing;
	syncing = (async () => {
		try {
			await syncNow(full);
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

function queueEventSync({ albums, artists }: RefreshedIds) {
	for (const id of albums) refreshedAlbums.add(id);
	for (const id of artists) refreshedArtists.add(id);
	clearTimeout(eventTimer);
	eventTimer = setTimeout(() => void checkForChanges(), LIBRARY_SYNC.eventDebounceMs);
}

function lead() {
	library.leader = true;
	void checkForChanges().then(() => requestEnrichment(true));
	listenToNavidrome(() => requireCredentials().token, { changed: queueEventSync, live: (live) => (eventsLive = live) });
	setInterval(() => {
		const due = !eventsLive || Date.now() - lastSyncAt >= LIBRARY_SYNC.livePollIntervalMs;
		void (due ? checkForChanges() : Promise.resolve()).then(() => requestEnrichment());
	}, LIBRARY_SYNC.pollIntervalMs);
}

async function onChannelMessage(event: MessageEvent<ChannelMessage>) {
	const message = event.data;
	if (message.kind === 'snapshot') {
		if (library.meta?.version === message.version && library.status === 'ready') return;
		try {
			await loaded(await call({ kind: 'reload' }));
		} catch (error) {
			failed(error);
		}
	} else if (message.kind === 'resync') {
		if (library.leader) await checkForChanges(message.full);
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
	if (library.meta) return;
	library.status = 'syncing';
	const result = await call({ kind: 'loadFile', url: SYNTHETIC_LIBRARY.snapshotUrl });
	library.timings = result.timings;
	await loaded(result.meta);
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
		await loaded(await call({ kind: 'open', userId, chunkBytes: devChunkBytes }));
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
	void navigator.storage?.persist?.();
	const leaderName = `vibemusic-library-leader-${userId}-v${SCHEMA_VERSION}`;
	if (!navigator.locks) {
		leadWhenFree(leaderName, lead);
		return;
	}
	void navigator.locks.request(leaderName, () => {
		lead();
		return new Promise(() => {});
	});
}

export async function resyncLibrary(full = false) {
	if (library.leader) await checkForChanges(full);
	else channel?.postMessage({ kind: 'resync', full } satisfies ChannelMessage);
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
