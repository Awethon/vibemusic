// Main-thread side of the library: talks to library.worker.ts, elects one leader tab per user
// (Web Lock, or lease.ts without it) that syncs from Navidrome and saves, and keeps other tabs
// up to date over a BroadcastChannel. UI code reads through query() and queries.ts.

import { onReconnect, reportReachable, reportUnreachable } from '../connection.svelte.ts';
import { NavidromeUnreachableError, SessionExpiredError } from '../navidrome/credentials.ts';
import { serverConfig } from '../serverConfig.ts';
import { renewToken, requireCredentials, sessionExpired } from '../session.svelte.ts';
import { listenToRelay, relay, sendToRelay } from '../remote/relay.svelte.ts';
import { ENRICHMENT, LIBRARY_SYNC } from '../tuning.ts';
import LibraryWorker from './library.worker.ts?worker';
import type { SqlParam, SyncProgress, SyncTimings, WorkerEnvelope, WorkerReply, WorkerRequest, WorkerResults } from './protocol.ts';
import { albumArt, artistArt } from '../navidrome/credentials.ts';
import { listenToNavidrome, type RefreshedIds } from '../navidrome/events.ts';
import { leadWhenFree } from './lease.ts';
import { SCHEMA_VERSION } from './schema.ts';
import type { Enrichment, LibraryMeta } from './snapshot.ts';

type Status = 'idle' | 'loading' | 'syncing' | 'ready' | 'error';

// Between tabs of the same user and schema version. snapshot: the leader saved a new version,
// reload it. patch: apply the same local edit to your copy. resync: ask the leader to sync.
// need-snapshot: a new tab has nothing saved yet and asks the leader to save.
type ChannelMessage =
	| { kind: 'snapshot'; version: string }
	| { kind: 'patch'; sql: string; params: SqlParam[] }
	| { kind: 'resync'; full: boolean }
	| { kind: 'need-snapshot' };

export const library = $state<{
	status: Status;
	meta: LibraryMeta | null;
	// Bumped on every change to the data; views re-run their queries when it changes.
	revision: number;
	leader: boolean;
	error: string;
	openMs: number;
	timings: SyncTimings | null;
	progress: SyncProgress | null;
}>({
	status: 'idle',
	meta: null,
	revision: 0,
	leader: false,
	error: '',
	openMs: 0,
	timings: null,
	progress: null
});

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
	else
		waiter.reject(reply.expired ? new SessionExpiredError() : reply.unreachable ? new NavidromeUnreachableError() : new Error(reply.error));
}

// Copies cover hashes and colours into the albumArt/artistArt maps that cover URLs and placeholders
// read. Only changed entries are set, so unchanged covers don't re-render.
async function refreshCoverStamps() {
	const [albums, artists] = await Promise.all([
		query<{ id: string; image_hash: string; dominant_color: string; thumb_hash: string }>(
			"select id, image_hash, dominant_color, thumb_hash from album where image_hash != '' or dominant_color != '' or thumb_hash != ''"
		),
		query<{ artist_id: string; dominant_color: string; thumb_hash: string }>(
			"select artist_id, dominant_color, thumb_hash from artist_art where thumb_hash != '' or dominant_color != ''"
		)
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
		// $state.snapshot: Svelte state proxies can't be sent through postMessage.
		result = await call({ kind: 'sync', credentials: $state.snapshot(requireCredentials()), full, albumIds, artistIds });
	} catch (error) {
		// Put the event ids back so the next attempt still refreshes them.
		for (const id of albumIds) refreshedAlbums.add(id);
		for (const id of artistIds) refreshedArtists.add(id);
		throw error;
	}
	lastSyncAt = Date.now();
	reportReachable();
	// The worker's requests may have received a rotated JWT.
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

// Only the leader asks the relay for enrichment, so several open tabs don't each trigger a run.
async function requestEnrichment(force = false) {
	if (!library.leader || !relay.connected || !library.meta) return;
	if (!force && Date.now() - lastEnrichmentRequestAt < ENRICHMENT.requestIntervalMs) return;
	lastEnrichmentRequestAt = Date.now();
	try {
		sendToRelay({ type: 'enrich', ...(await call({ kind: 'enrichmentRequest' })) });
	} catch {
		lastEnrichmentRequestAt = 0;
	}
}

// The relay sends enrichment in pieces as it finds it. Applying rebuilds all derived tables and
// saves, so pieces are merged and applied at most once per ENRICHMENT.applyIntervalMs.
function queueEnrichment(enrichment: Enrichment) {
	if (
		[enrichment.releaseGroups, enrichment.mbArtists, enrichment.deezer, enrichment.artistMatches ?? {}, enrichment.apple ?? {}].every(
			(part) => !Object.keys(part).length
		)
	)
		return;
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
	enrichmentTimer = setTimeout(
		applyEnrichment,
		Math.max(ENRICHMENT.applyDelayMs, lastEnrichmentAt + ENRICHMENT.applyIntervalMs - Date.now())
	);
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

// Never runs two syncs at once; callers during a sync share the running one.
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

// Events come in bursts (a scan, a play touching album and artist), so they are debounced into one sync.
function queueEventSync({ albums, artists }: RefreshedIds) {
	for (const id of albums) refreshedAlbums.add(id);
	for (const id of artists) refreshedArtists.add(id);
	clearTimeout(eventTimer);
	eventTimer = setTimeout(() => void checkForChanges(), LIBRARY_SYNC.eventDebounceMs);
}

// Returns a function that stops leading, for lease.ts; a Web Lock is never given up.
function lead(): () => void {
	library.leader = true;
	// Tabs that don't lead never save. If this one changed its copy while loading (new genre rules,
	// see loadSnapshot in the worker), that is saved now. No library yet: the first sync saves.
	if (library.meta) void call({ kind: 'persist' }).catch(() => {});
	void checkForChanges().then(() => requestEnrichment(true));
	const stopListening = listenToNavidrome(() => requireCredentials().token, {
		changed: queueEventSync,
		live: (live) => (eventsLive = live)
	});
	// Polling is the fallback; while the event stream is live it only runs every livePollIntervalMs.
	const polling = setInterval(() => {
		const due = !eventsLive || Date.now() - lastSyncAt >= LIBRARY_SYNC.livePollIntervalMs;
		void (due ? checkForChanges() : Promise.resolve()).then(() => requestEnrichment());
	}, LIBRARY_SYNC.pollIntervalMs);
	return () => {
		library.leader = false;
		stopListening();
		clearInterval(polling);
		clearTimeout(eventTimer);
		eventsLive = false;
	};
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
		// Keeps this tab's in-memory copy in step without waiting for the leader's next save.
		await call({ kind: 'run', sql: message.sql, params: message.params, persist: library.leader });
		library.revision += 1;
	}
}

export async function startLibrary() {
	if (worker) return;
	const userId = requireCredentials().userId;
	library.status = 'loading';
	worker = new LibraryWorker();
	worker.addEventListener('message', onWorkerReply);
	// The worker waits for this before handling anything else (see library.worker.ts).
	void serverConfig().then((config) => call({ kind: 'configure', genrePlaylists: config.genrePlaylists }));
	// The channel and the leader lock include the schema version, so tabs running an older app
	// version (different database layout) never share a leader or snapshots with newer ones.
	channel = new BroadcastChannel(`vibemusic-library-${userId}-v${SCHEMA_VERSION}`);
	channel.addEventListener('message', onChannelMessage);
	try {
		const openStarted = performance.now();
		await loaded(await call({ kind: 'open', userId }));
		library.openMs = performance.now() - openStarted;
		if (!library.meta) {
			library.status = 'syncing';
			channel.postMessage({ kind: 'need-snapshot' } satisfies ChannelMessage);
		}
	} catch (error) {
		failed(error);
	}
	// Ask the browser not to evict the saved library under storage pressure.
	void navigator.storage?.persist?.();
	const leaderName = `vibemusic-library-leader-${userId}-v${SCHEMA_VERSION}`;
	// Web Locks are missing outside secure contexts (plain http); fall back to a localStorage lease.
	if (!navigator.locks) {
		leadWhenFree(leaderName, lead);
		return;
	}
	void navigator.locks.request(leaderName, () => {
		lead();
		// Never resolves on purpose: the lock is held, and this tab stays leader, until it closes.
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

/**
 * Applies a small local edit (star, play count, palette) to this tab's database and broadcasts
 * the same SQL to other tabs. The leader also saves it; the server is updated separately.
 */
export async function patchLibrary(sql: string, params: SqlParam[]) {
	await call({ kind: 'run', sql, params, persist: library.leader });
	channel?.postMessage({ kind: 'patch', sql, params } satisfies ChannelMessage);
	library.revision += 1;
}
