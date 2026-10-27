import { navidrome, requireCredentials } from '../session.svelte.ts';
import { streamUrl } from '../navidrome/credentials.ts';
import { patchLibrary } from '../library/library.svelte.ts';
import { tracksByIds, type Track } from '../library/queries.ts';
import { rememberPlayedList } from '../history.svelte.ts';
import { checkConnection, isUnreachable, onReconnect } from '../connection.svelte.ts';
import { showToast } from '../ui/state.svelte.ts';
import { CONNECTION, PLAYBACK, REMOTE } from '../tuning.ts';
import { deviceLabel } from '../remote/devices.ts';
import { activeIsOnline, isActiveElsewhere, relay, sendToRelay, startRelay, type RelayMessage } from '../remote/relay.svelte.ts';
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

export type Command =
	| { kind: 'playList'; trackIds: string[]; startIndex: number; sourceName: string; listKey: string }
	| { kind: 'togglePlay' }
	| { kind: 'next' }
	| { kind: 'previous' }
	| { kind: 'seek'; seconds: number }
	| { kind: 'volume'; volume: number }
	| { kind: 'mute'; muted: boolean }
	| { kind: 'queueNext' | 'queueLast'; trackIds: string[]; sourceName: string }
	| { kind: 'playQueuedAt' | 'playSourceNow'; index: number }
	| { kind: 'edit'; edit: queue.QueueEdit }
	| { kind: 'liked'; trackId: string; starred: boolean };

type Playback = { trackId: string; playing: boolean; position: number; duration: number; volume: number; muted: boolean; starred: boolean; waiting: boolean };

const CLAIMING_COMMANDS = new Set<Command['kind']>(['playList', 'togglePlay', 'next', 'previous', 'playQueuedAt', 'playSourceNow', 'seek']);

const storedVolume = () => Number(localStorage.getItem(VOLUME_KEY) ?? PLAYBACK.initialVolume);

const queueState = queue.emptyQueue();
const trackCache = new Map<string, Track>();

export const player = $state({
	queueRevision: 0,
	trackRevision: 0,
	playing: false,
	buffering: false,
	position: 0,
	duration: 0,
	volume: storedVolume(),
	muted: false,
	waitingForTap: false,
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

let mirroring = false;
let mirroredAt = 0;
let mirroredPosition = 0;
let mirrorSequence = 0;
let resumeAt = { trackId: '', position: 0 };
let publishedPlayback = '';
let publishedAt = 0;
let publishedPosition = 0;
let announced = false;
let takingOver = false;
let queuePublishTimer: ReturnType<typeof setTimeout> | undefined;

const publishing = () => relay.connected && relay.active === relay.deviceId;

function queueChanged() {
	player.queueRevision += 1;
	if (!publishing()) return;
	clearTimeout(queuePublishTimer);
	queuePublishTimer = setTimeout(publishQueue, REMOTE.queuePublishDelayMs);
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
	if (mirroring) return;
	if (engine.playing && !engine.buffering) failedInRow = 0;
	if (engine.playing) player.waitingForTap = false;
	player.playing = engine.playing;
	player.buffering = engine.buffering;
	player.position = engine.position;
	player.duration = engine.duration || currentTrack()?.duration || 0;
	updateMediaSession(currentTrack(), player.playing, player.position, player.duration);
	if (publishing() && (playbackSignature() !== publishedPlayback || positionJumped())) publishPlayback();
}

function positionJumped() {
	const expected = publishedPosition + (player.playing ? (Date.now() - publishedAt) / 1000 : 0);
	return Math.abs(player.position - expected) > REMOTE.positionJumpSeconds;
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
	const started = await engine.load(trackId, streamUrl(requireCredentials(), trackId), { autoplay, startAt });
	if (started === 'blocked') waitForTap();
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
	if (mirroring) {
		if (player.playing) player.position = Math.min(player.duration || Infinity, mirroredPosition + (now - mirroredAt) / 1000);
		updateMediaSession(currentTrack(), player.playing, player.position, player.duration);
		return;
	}
	refresh();
	if (publishing() && player.playing && Date.now() - publishedAt > REMOTE.playbackResyncMs) publishPlayback();
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
	for (const type of ['click', 'touchend', 'keydown']) addEventListener(type, onGesture, { capture: true });
	installMediaSession({
		play: () => {
			if (!player.playing) togglePlay();
		},
		pause: () => {
			if (player.playing) togglePlay();
		},
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
		if (!tracks.length || queueState.currentTrackId || mirroring) return;
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

function waitForTap() {
	player.waitingForTap = true;
	refresh();
}

async function resumeEngine() {
	if ((await engine.resume()) === 'blocked') waitForTap();
}

function onGesture(event: Event) {
	if (mirroring) return;
	engine.wake();
	if (!player.waitingForTap || (event.target as Element | null)?.closest?.('.cap-ctrl')) return;
	player.waitingForTap = false;
	void resumeEngine();
}

function playbackSnapshot(): Playback {
	return {
		trackId: queueState.currentTrackId,
		playing: player.playing,
		position: player.position,
		duration: player.duration,
		volume: player.volume,
		muted: player.muted,
		starred: currentTrack()?.starred ?? false,
		waiting: player.waitingForTap
	};
}

function playbackSignature() {
	const { trackId, playing, duration, volume, muted, starred, waiting } = playbackSnapshot();
	return [trackId, playing, Math.round(duration), volume, muted, starred, waiting].join('|');
}

function publishPlayback() {
	publishedPlayback = playbackSignature();
	publishedAt = Date.now();
	publishedPosition = player.position;
	sendToRelay({ type: 'playback', playback: playbackSnapshot() });
}

function publishQueue() {
	if (publishing()) sendToRelay({ type: 'queue', queue: queue.copyQueue(queueState) });
}

async function ensureTracks(trackIds: string[]) {
	const missing = trackIds.filter((trackId) => !trackCache.has(trackId));
	if (missing.length) remember(await tracksByIds(missing));
}

async function mirrorQueue(snapshot: queue.QueueState | null) {
	if (!snapshot) return;
	const sequence = ++mirrorSequence;
	await ensureTracks(queue.queuedTrackIds(snapshot));
	if (sequence !== mirrorSequence || !mirroring) return;
	queue.replaceQueue(queueState, snapshot);
	queueChanged();
}

function mirrorPlayback(playback: Playback | null, ageMs: number) {
	if (!playback) return;
	player.playing = playback.playing && activeIsOnline();
	player.buffering = false;
	player.duration = playback.duration;
	player.volume = playback.volume;
	player.muted = playback.muted;
	player.waitingForTap = playback.waiting && activeIsOnline();
	mirroredPosition = playback.position + (player.playing ? ageMs / 1000 : 0);
	mirroredAt = performance.now();
	player.position = mirroredPosition;
	const cached = trackCache.get(playback.trackId);
	if (cached && cached.starred !== playback.starred) {
		trackCache.set(playback.trackId, { ...cached, starred: playback.starred });
		player.trackRevision += 1;
	}
}

function enterMirror() {
	if (mirroring) return;
	mirroring = true;
	engine.pause();
	clearTimeout(queuePublishTimer);
}

function leaveMirror() {
	if (!mirroring) return;
	mirroring = false;
	resumeAt = { trackId: queueState.currentTrackId, position: player.position };
	if (engine.trackId === resumeAt.trackId) engine.seek(resumeAt.position);
	player.volume = storedVolume();
	player.muted = false;
	player.waitingForTap = false;
	player.playing = engine.playing;
	applyLevel();
}

function predict(command: Command) {
	const restartClock = (playing: boolean, position: number) => {
		player.playing = playing;
		mirroredPosition = position;
		mirroredAt = performance.now();
		player.position = position;
	};
	const predicted = (effect: queue.QueueEffect) => {
		queueChanged();
		if (effect === 'play' || effect === 'restart') restartClock(true, 0);
	};
	switch (command.kind) {
		case 'playList':
			return predicted(queue.playList(queueState, command.trackIds, command.startIndex, command.sourceName, command.listKey));
		case 'togglePlay':
			return restartClock(!player.playing, player.position);
		case 'next':
			return predicted(queue.playNext(queueState));
		case 'previous':
			return predicted(queue.playPrevious(queueState, player.position, PLAYBACK.restartInsteadOfPreviousAfterSeconds));
		case 'seek':
			return restartClock(player.playing, command.seconds);
		case 'volume':
			player.volume = command.volume;
			player.muted = false;
			return;
		case 'mute':
			player.muted = command.muted;
			return;
		case 'queueNext':
			return predicted(queue.queueTracksNext(queueState, command.trackIds, command.sourceName));
		case 'queueLast':
			return predicted(queue.queueTracksLast(queueState, command.trackIds, command.sourceName));
		case 'playQueuedAt':
			return predicted(queue.playQueuedAt(queueState, command.index));
		case 'playSourceNow':
			return predicted(queue.playSourceNow(queueState, command.index));
		case 'edit':
			queue.applyEdit(queueState, command.edit);
			return queueChanged();
		case 'liked':
			return;
	}
}

function run(command: Command) {
	switch (command.kind) {
		case 'playList':
			return apply(queue.playList(queueState, command.trackIds, command.startIndex, command.sourceName, command.listKey));
		case 'togglePlay': {
			if (!queueState.currentTrackId) return;
			if (engine.playing) {
				engine.pause();
				void saveQueue();
			} else if (engine.trackId === queueState.currentTrackId && !player.error) void resumeEngine();
			else void startCurrent(true, engine.trackId === queueState.currentTrackId ? engine.position : resumeAt.trackId === queueState.currentTrackId ? resumeAt.position : 0);
			return;
		}
		case 'next':
			return apply(queue.playNext(queueState));
		case 'previous':
			return apply(queue.playPrevious(queueState, engine.position, PLAYBACK.restartInsteadOfPreviousAfterSeconds));
		case 'seek':
			engine.seek(command.seconds);
			refresh();
			if (publishing()) publishPlayback();
			return scheduleSave();
		case 'volume':
			player.volume = Math.min(1, Math.max(0, command.volume));
			player.muted = false;
			localStorage.setItem(VOLUME_KEY, String(player.volume));
			applyLevel();
			return refresh();
		case 'mute':
			player.muted = command.muted;
			applyLevel();
			return refresh();
		case 'queueNext':
			return apply(queue.queueTracksNext(queueState, command.trackIds, command.sourceName));
		case 'queueLast':
			return apply(queue.queueTracksLast(queueState, command.trackIds, command.sourceName));
		case 'playQueuedAt':
			return apply(queue.playQueuedAt(queueState, command.index));
		case 'playSourceNow':
			return apply(queue.playSourceNow(queueState, command.index));
		case 'edit':
			queue.applyEdit(queueState, command.edit);
			queueChanged();
			prepareNext();
			return scheduleSave();
		case 'liked': {
			const cached = trackCache.get(command.trackId);
			if (cached) {
				trackCache.set(command.trackId, { ...cached, starred: command.starred });
				player.trackRevision += 1;
			}
			return refresh();
		}
	}
}

function perform(command: Command) {
	if (mirroring && activeIsOnline()) {
		sendToRelay({ type: 'command', command });
		predict(command);
		return;
	}
	if (CLAIMING_COMMANDS.has(command.kind) && relay.connected && relay.active !== relay.deviceId) {
		leaveMirror();
		sendToRelay({ type: 'claim' });
	}
	run(command);
}

async function obey(command: Command) {
	if ('trackIds' in command) await ensureTracks(command.trackIds);
	run(command);
}

async function takeOver(snapshot: queue.QueueState | null, playback: Playback | null, ageMs: number) {
	mirrorSequence += 1;
	leaveMirror();
	if (!snapshot?.currentTrackId) return;
	takingOver = true;
	try {
		await ensureTracks(queue.queuedTrackIds(snapshot));
		queue.replaceQueue(queueState, snapshot);
	} finally {
		takingOver = false;
	}
	queueChanged();
	announced = false;
	announceIfActive();
	const playing = playback?.playing ?? false;
	const position = (playback?.position ?? 0) + (playing ? ageMs / 1000 : 0);
	await startCurrent(playing, playback?.trackId === snapshot.currentTrackId ? position : 0);
	if (!player.waitingForTap) showToast('Playing in this tab');
}

function release(to: string, handoff: boolean) {
	const playback = { ...playbackSnapshot(), position: engine.position || player.position };
	engine.pause();
	if (handoff) sendToRelay({ type: 'handoff', to, queue: queue.copyQueue(queueState), playback });
	enterMirror();
	mirrorPlayback({ ...playback, playing: handoff && playback.playing }, 0);
	const name = deviceLabel(to);
	if (handoff && name) showToast(`Moved playback to ${name}`);
}

function announceIfActive() {
	if (takingOver) return;
	if (!publishing()) {
		announced = false;
		return;
	}
	if (announced) return;
	announced = true;
	publishQueue();
	publishPlayback();
}

function onRelayMessage(message: RelayMessage) {
	switch (message.type) {
		case 'welcome':
			announced = false;
			if (isActiveElsewhere()) {
				enterMirror();
				void mirrorQueue(message.queue as queue.QueueState | null);
				mirrorPlayback(message.playback as Playback | null, message.ageMs);
			} else if (!relay.active && player.playing) sendToRelay({ type: 'claim' });
			announceIfActive();
			return;
		case 'devices':
			if (isActiveElsewhere()) {
				enterMirror();
				if (!activeIsOnline()) player.playing = false;
			} else if (relay.active === relay.deviceId && mirroring) leaveMirror();
			announceIfActive();
			return;
		case 'queue':
			if (mirroring) void mirrorQueue(message.queue as queue.QueueState);
			return;
		case 'playback':
			if (mirroring) mirrorPlayback(message.playback as Playback, message.ageMs);
			return;
		case 'command':
			if (!mirroring) void obey(message.command as Command);
			return;
		case 'release':
			return release(message.to, message.handoff);
		case 'takeover':
			void takeOver(message.queue as queue.QueueState | null, message.playback as Playback | null, message.ageMs);
			return;
	}
}

export function startRemoteControl() {
	void startRelay(onRelayMessage);
}

export function playOn(deviceId: string) {
	if (deviceId === relay.active) return;
	if (deviceId === relay.deviceId && !activeIsOnline()) {
		void takeOver(queue.copyQueue(queueState), { ...playbackSnapshot(), playing: true }, 0);
		sendToRelay({ type: 'claim' });
		return;
	}
	sendToRelay({ type: 'transfer', to: deviceId });
}

export function playTracks(tracks: Track[], startIndex: number, sourceName: string, listKey: string) {
	remember(tracks);
	rememberPlayedList(listKey);
	perform({ kind: 'playList', trackIds: tracks.map((track) => track.id), startIndex, sourceName, listKey });
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
	if (queueState.currentTrackId) perform({ kind: 'togglePlay' });
}

export const playNextTrack = () => perform({ kind: 'next' });

export const playPreviousTrack = () => perform({ kind: 'previous' });

export const seekTo = (seconds: number) => perform({ kind: 'seek', seconds });

export const seekBy = (seconds: number) => seekTo(player.position + seconds);

export const setVolume = (volume: number) => perform({ kind: 'volume', volume: Math.min(1, Math.max(0, volume)) });

export const toggleMute = () => perform({ kind: 'mute', muted: !player.muted });

export function queueNext(tracks: Track[], sourceName: string) {
	remember(tracks);
	perform({ kind: 'queueNext', trackIds: tracks.map((track) => track.id), sourceName });
}

export function queueLast(tracks: Track[], sourceName: string) {
	remember(tracks);
	perform({ kind: 'queueLast', trackIds: tracks.map((track) => track.id), sourceName });
}

export const playQueuedAt = (index: number) => perform({ kind: 'playQueuedAt', index });
export const playSourceNow = (index: number) => perform({ kind: 'playSourceNow', index });

export const editQueue = (edit: queue.QueueEdit) => perform({ kind: 'edit', edit });

export async function toggleLike(track: Track) {
	const starred = !track.starred;
	await navidrome().subsonic(starred ? 'star' : 'unstar', { id: track.id });
	await patchLibrary('update track set starred = ? where id = ?', [starred ? 1 : 0, track.id]);
	const cached = trackCache.get(track.id);
	if (cached) {
		trackCache.set(track.id, { ...cached, starred });
		player.trackRevision += 1;
	}
	if (mirroring) sendToRelay({ type: 'command', command: { kind: 'liked', trackId: track.id, starred } satisfies Command });
	else refresh();
}

export const sampleAudio = (nowMs: number) => engine.sample(nowMs);
export const audioLive = () => !mirroring && engine.live && player.playing;
