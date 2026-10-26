import { navidrome, requireCredentials } from '../session.svelte.ts';
import { streamUrl } from '../navidrome/credentials.ts';
import { patchLibrary } from '../library/library.svelte.ts';
import { tracksByIds, type Track } from '../library/queries.ts';
import { rememberPlayedList } from '../history.svelte.ts';
import { checkConnection, isUnreachable, onReconnect } from '../connection.svelte.ts';
import { showToast } from '../ui/state.svelte.ts';
import { CONNECTION, PLAYBACK } from '../tuning.ts';
import { AudioEngine } from './engine.ts';
import * as queue from './queue.ts';
import { updateMediaSession, installMediaSession } from './mediaSession.ts';

const TICK_MS = 100;
const SAVE_DELAY_MS = 3000;
const SAVE_WHILE_PLAYING_MS = 30000;
const SCROBBLE_MIN_TRACK_SECONDS = 30;
const SCROBBLE_AFTER_SECONDS = 240;
const SOURCE_NAME_KEY = 'vibemusic.queue.source';
const VOLUME_KEY = 'vibemusic.volume';
const PENDING_SCROBBLES_KEY = 'vibemusic.pendingScrobbles';

type PendingScrobble = { trackId: string; albumId: string; time: number };

const queueState = queue.emptyQueue();
const trackCache = new Map<string, Track>();

export const player = $state({
	queueRevision: 0,
	trackRevision: 0,
	playing: false,
	buffering: false,
	position: 0,
	duration: 0,
	volume: Number(localStorage.getItem(VOLUME_KEY) ?? PLAYBACK.initialVolume),
	muted: false,
	error: ''
});

export function playerQueue(): Readonly<queue.QueueState> {
	void player.queueRevision;
	return queueState;
}

export function trackById(trackId: string): Track | undefined {
	void player.trackRevision;
	return trackCache.get(trackId);
}

export function totalDuration(entries: readonly queue.Entry[]): number {
	void player.trackRevision;
	let seconds = 0;
	for (const entry of entries) seconds += trackCache.get(entry.trackId)?.duration ?? 0;
	return seconds;
}

export const currentTrack = (): Track | null => trackById(playerQueue().currentTrackId) ?? null;

function queueChanged() {
	player.queueRevision += 1;
}

const engine = new AudioEngine({
	ended: () => apply(queue.playNext(queueState)),
	failed: (message) => void playbackFailed(message),
	changed: () => refresh()
});

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let lastSavedAt = 0;
let lastTickAt = 0;
let listenedSeconds = 0;
let scrobbled = false;
let failedInRow = 0;
let handlingFailure = false;

async function playbackFailed(message: string) {
	if (handlingFailure) return;
	handlingFailure = true;
	try {
		await recoverFromFailure(message);
	} finally {
		handlingFailure = false;
	}
}

async function recoverFromFailure(message: string) {
	const track = currentTrack();
	player.error = message;
	const title = track ? `“${track.title}”` : 'this track';
	if (!(await checkConnection())) {
		engine.pause();
		showToast(`Couldn’t play ${title} — Navidrome isn’t reachable`);
		return;
	}
	failedInRow += 1;
	if (failedInRow >= CONNECTION.skipFailedTracksInRow) {
		failedInRow = 0;
		engine.pause();
		showToast(`Couldn’t play ${title} or the tracks before it`);
		return;
	}
	showToast(`Couldn’t play ${title}, skipped`);
	apply(queue.playNext(queueState));
}

function remember(tracks: Track[]) {
	let added = false;
	for (const track of tracks) {
		if (trackCache.get(track.id) === track) continue;
		trackCache.set(track.id, track);
		added = true;
	}
	if (added) player.trackRevision += 1;
}

function refresh() {
	if (engine.playing && !engine.buffering) failedInRow = 0;
	player.playing = engine.playing;
	player.buffering = engine.buffering;
	player.position = engine.position;
	player.duration = engine.duration || currentTrack()?.duration || 0;
	updateMediaSession(currentTrack(), player.playing, player.position, player.duration);
}

function applyLevel() {
	engine.setLevel(player.muted ? 0 : player.volume * player.volume);
}

function prepareNext() {
	const next = queue.nextEntry(queueState);
	engine.prepare(next?.trackId ?? null, next ? streamUrl(requireCredentials(), next.trackId) : null);
}

async function startCurrent(autoplay = true, startAt = 0) {
	const trackId = queueState.currentTrackId;
	if (!trackId) return;
	player.error = '';
	listenedSeconds = 0;
	scrobbled = false;
	await engine.load(trackId, streamUrl(requireCredentials(), trackId), { autoplay, startAt });
	prepareNext();
	refresh();
	if (autoplay) void navidrome().subsonic('scrobble', { id: trackId, submission: 'false' }).catch(() => {});
}

function apply(effect: queue.QueueEffect) {
	queueChanged();
	if (effect === 'play') void startCurrent();
	else if (effect === 'restart') engine.seek(0);
	else if (effect === 'stop') engine.stop();
	if (effect !== 'play') prepareNext();
	scheduleSave();
}

function scheduleSave() {
	clearTimeout(saveTimer);
	saveTimer = setTimeout(saveQueue, SAVE_DELAY_MS);
}

async function saveQueue() {
	if (!queueState.currentTrackId) return;
	lastSavedAt = Date.now();
	const { trackIds } = queue.savedOrder(queueState);
	try {
		localStorage.setItem(SOURCE_NAME_KEY, queueState.sourceName);
		await navidrome().subsonic('savePlayQueue', { id: trackIds, current: queueState.currentTrackId, position: Math.round(engine.position * 1000) });
	} catch {
		return;
	}
}

const pendingScrobblesKey = () => `${PENDING_SCROBBLES_KEY}:${requireCredentials().userId}`;

function pendingScrobbles(): PendingScrobble[] {
	try {
		return JSON.parse(localStorage.getItem(pendingScrobblesKey()) ?? '[]') as PendingScrobble[];
	} catch {
		return [];
	}
}

function keepPendingScrobbles(scrobbles: PendingScrobble[]) {
	if (scrobbles.length) localStorage.setItem(pendingScrobblesKey(), JSON.stringify(scrobbles));
	else localStorage.removeItem(pendingScrobblesKey());
}

async function sendScrobble(scrobble: PendingScrobble) {
	await navidrome().subsonic('scrobble', { id: scrobble.trackId, submission: 'true', time: scrobble.time });
	const playedAt = new Date(scrobble.time).toISOString();
	await patchLibrary('update track set play_count = play_count + 1, play_date = max(play_date, ?) where id = ?', [playedAt, scrobble.trackId]);
	await patchLibrary('update album set play_count = play_count + 1, play_date = max(play_date, ?) where id = ?', [playedAt, scrobble.albumId]);
}

async function submitScrobble(track: Track) {
	scrobbled = true;
	const scrobble = { trackId: track.id, albumId: track.albumId, time: Date.now() };
	try {
		await sendScrobble(scrobble);
	} catch (error) {
		if (isUnreachable(error)) keepPendingScrobbles([...pendingScrobbles(), scrobble]);
		else scrobbled = false;
	}
}

async function sendPendingScrobbles() {
	const waiting = pendingScrobbles();
	while (waiting.length) {
		try {
			await sendScrobble(waiting[0]);
		} catch (error) {
			if (isUnreachable(error)) break;
		}
		waiting.shift();
		keepPendingScrobbles(waiting);
	}
}

function tick() {
	const now = performance.now();
	const elapsed = lastTickAt ? (now - lastTickAt) / 1000 : 0;
	lastTickAt = now;
	refresh();
	const track = currentTrack();
	if (!track || !player.playing) return;
	listenedSeconds += Math.min(elapsed, 1);
	const duration = player.duration || track.duration;
	if (!scrobbled && duration >= SCROBBLE_MIN_TRACK_SECONDS && listenedSeconds >= Math.min(duration / 2, SCROBBLE_AFTER_SECONDS)) void submitScrobble(track);
	if (Date.now() - lastSavedAt > SAVE_WHILE_PLAYING_MS) void saveQueue();
}

export function startPlayer() {
	applyLevel();
	onReconnect(() => {
		void sendPendingScrobbles();
		void saveQueue();
	});
	void sendPendingScrobbles();
	setInterval(tick, TICK_MS);
	installMediaSession({
		play: () => void engine.resume(),
		pause: () => engine.pause(),
		next: playNextTrack,
		previous: playPreviousTrack,
		seek: seekTo
	});
}

export async function restoreSavedQueue() {
	if (queueState.currentTrackId) return;
	type SavedQueue = { playQueue?: { entry?: { id: string }[]; current?: string; position?: number } };
	try {
		const saved = (await navidrome().subsonic<SavedQueue>('getPlayQueue')).playQueue;
		const ids = saved?.entry?.map((entry) => entry.id) ?? [];
		if (!ids.length) return;
		const tracks = await tracksByIds(ids);
		if (!tracks.length || queueState.currentTrackId) return;
		remember(tracks);
		const known = tracks.map((track) => track.id);
		const currentIndex = Math.max(0, known.indexOf(saved?.current ?? ''));
		queue.restoreQueue(queueState, known, currentIndex, localStorage.getItem(SOURCE_NAME_KEY) ?? '');
		queueChanged();
		await startCurrent(false, (saved?.position ?? 0) / 1000);
	} catch {
		return;
	}
}

export function playTracks(tracks: Track[], startIndex: number, sourceName: string, listKey: string) {
	remember(tracks);
	rememberPlayedList(listKey);
	apply(queue.playList(queueState, tracks.map((track) => track.id), startIndex, sourceName, listKey));
}

export function isPlayingList(listKey: string) {
	return player.playing && queueState.sourceKey === listKey && !!listKey;
}

export function togglePlayList(tracks: Track[], sourceName: string, listKey: string) {
	if (queueState.sourceKey === listKey && listKey && tracks.some((track) => track.id === queueState.currentTrackId)) togglePlay();
	else playTracks(tracks, 0, sourceName, listKey);
}

export function playTrackInList(tracks: Track[], index: number, sourceName: string, listKey: string) {
	if (tracks[index]?.id === queueState.currentTrackId && queueState.sourceKey === listKey) togglePlay();
	else playTracks(tracks, index, sourceName, listKey);
}

export function togglePlay() {
	if (!queueState.currentTrackId) return;
	if (engine.playing) {
		engine.pause();
		void saveQueue();
	} else if (engine.trackId && !player.error) void engine.resume();
	else void startCurrent(true, engine.trackId === queueState.currentTrackId ? engine.position : 0);
}

export function playNextTrack() {
	apply(queue.playNext(queueState));
}

export function playPreviousTrack() {
	apply(queue.playPrevious(queueState, engine.position, PLAYBACK.restartInsteadOfPreviousAfterSeconds));
}

export function seekTo(seconds: number) {
	engine.seek(seconds);
	refresh();
	scheduleSave();
}

export const seekBy = (seconds: number) => seekTo(engine.position + seconds);

export function setVolume(volume: number) {
	player.volume = Math.min(1, Math.max(0, volume));
	player.muted = false;
	localStorage.setItem(VOLUME_KEY, String(player.volume));
	applyLevel();
}

export function toggleMute() {
	player.muted = !player.muted;
	applyLevel();
}

export function queueNext(tracks: Track[], sourceName: string) {
	remember(tracks);
	apply(queue.queueTracksNext(queueState, tracks.map((track) => track.id), sourceName));
}

export function queueLast(tracks: Track[], sourceName: string) {
	remember(tracks);
	apply(queue.queueTracksLast(queueState, tracks.map((track) => track.id), sourceName));
}

export const playQueuedAt = (index: number) => apply(queue.playQueuedAt(queueState, index));
export const playSourceNow = (index: number) => apply(queue.playSourceNow(queueState, index));

export function editQueue(edit: (state: queue.QueueState) => void) {
	edit(queueState);
	queueChanged();
	prepareNext();
	scheduleSave();
}

export async function toggleLike(track: Track) {
	const starred = !track.starred;
	await navidrome().subsonic(starred ? 'star' : 'unstar', { id: track.id });
	await patchLibrary('update track set starred = ? where id = ?', [starred ? 1 : 0, track.id]);
	const cached = trackCache.get(track.id);
	if (cached) {
		trackCache.set(track.id, { ...cached, starred });
		player.trackRevision += 1;
	}
}

export const sampleAudio = (nowMs: number) => engine.sample(nowMs);
export const audioLive = () => engine.live && player.playing;
