// Local playback: runs commands against the queue and the audio engine, keeps `player` state in
// sync, saves the queue to Navidrome, scrobbles, and handles failures and autoplay blocks.
// While this tab only mirrors another device (remote.svelte.ts), it leaves `player` alone.

import { checkConnection, onReconnect } from '../connection.svelte.ts';
import { isRadio, tracksByIds } from '../library/queries.ts';
import { streamUrl } from '../navidrome/credentials.ts';
import { requireCredentials } from '../session.svelte.ts';
import { CONNECTION, PLAYBACK, SAVED_QUEUE } from '../tuning.ts';
import { showToast } from '../ui/state.svelte.ts';
import { applyToQueue, type Command } from './commands.ts';
import { AudioEngine } from './engine.ts';
import { installMediaSession, updateMediaSession, type MediaHandlers } from './mediaSession.ts';
import * as queue from './queue.ts';
import { pollRadio } from './radioNow.svelte.ts';
import { fetchSavedQueue, saveIsDue, saveQueue } from './savedQueue.ts';
import { announceNowPlaying, listened, resetListening, sendPendingScrobbles } from './scrobbles.ts';
import { currentTrack, player, queueChanged, queueState, remember, setStarred, storedVolume, VOLUME_KEY } from './state.svelte.ts';

// Hooks that remote.svelte.ts installs, so this module doesn't import it (that would be circular).
export type RemoteHooks = { mirroring(): boolean; refreshed(force: boolean): void; ticked(nowMs: number): void };

let remote: RemoteHooks = { mirroring: () => false, refreshed: () => {}, ticked: () => {} };
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let lastTickAt = 0;
let failedInRow = 0;
let handlingFailure = false;
let resumeAt = { trackId: '', position: 0 };

const engine = new AudioEngine({
	ended: () => apply(queue.playNext(queueState)),
	failed: (message) => void playbackFailed(message),
	changed: () => refreshPlayback()
});

export function connectRemote(hooks: RemoteHooks) {
	remote = hooks;
}

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
	// Several broken tracks in a row usually mean a bigger problem: stop instead of skipping through the queue.
	if (failedInRow >= CONNECTION.skipFailedTracksInRow) {
		failedInRow = 0;
		engine.pause();
		showToast(`Couldn’t play ${title} or the tracks before it`);
		return;
	}
	showToast(`Couldn’t play ${title}, skipped`);
	apply(queue.playNext(queueState));
}

export function refreshPlayback(force = false) {
	if (remote.mirroring()) return;
	if (engine.playing && !engine.buffering) failedInRow = 0;
	if (engine.playing) player.waitingForTap = false;
	player.playing = engine.playing;
	player.buffering = engine.buffering;
	player.position = engine.position;
	// The library's duration comes first: Safari estimates the length of Ogg files from their bitrate
	// and can be off by minutes (radio streams have no library duration).
	player.duration = currentTrack()?.duration || engine.duration || 0;
	updateMediaSession(currentTrack(), player.playing, player.position, player.duration);
	remote.refreshed(force);
}

// Squared so the volume slider feels closer to perceived loudness.
function applyLevel() {
	engine.setLevel(player.muted ? 0 : player.volume * player.volume);
}

function prepareNext() {
	const next = queue.nextEntry(queueState);
	if (next && isRadio(next.trackId)) return engine.prepare(null, null);
	engine.prepare(next?.trackId ?? null, next ? streamUrl(requireCredentials(), next.trackId) : null);
}

export async function startCurrent(autoplay = true, startAt = 0) {
	const trackId = queueState.currentTrackId;
	if (!trackId) return;
	player.error = '';
	resetListening();
	const started = await engine.load(trackId, streamUrl(requireCredentials(), trackId), { autoplay, startAt });
	if (started === 'blocked') waitForTap();
	prepareNext();
	refreshPlayback();
	if (autoplay && !isRadio(trackId)) announceNowPlaying(trackId);
}

function apply(effect: queue.QueueEffect) {
	queueChanged();
	if (effect === 'play') void startCurrent();
	else if (effect === 'restart') engine.seek(0);
	else if (effect === 'stop') engine.stop();
	if (effect !== 'play') prepareNext();
	scheduleSave();
}

const saveNow = () => void saveQueue(queueState, engine.position);

function scheduleSave() {
	clearTimeout(saveTimer);
	saveTimer = setTimeout(saveNow, SAVED_QUEUE.saveDelayMs);
}

function tick() {
	const now = performance.now();
	const elapsed = lastTickAt ? (now - lastTickAt) / 1000 : 0;
	lastTickAt = now;
	remote.ticked(now);
	pollRadio(queueState.currentTrackId, now);
	if (remote.mirroring()) return;
	refreshPlayback();
	const track = currentTrack();
	if (!track || !player.playing || isRadio(track.id)) return;
	listened(track, elapsed, player.duration || track.duration);
	if (saveIsDue()) saveNow();
}

function waitForTap() {
	player.waitingForTap = true;
	refreshPlayback();
}

async function resumeEngine() {
	if ((await engine.resume()) === 'blocked') waitForTap();
}

function onGesture(event: Event) {
	if (remote.mirroring()) return;
	engine.wake();
	// Any tap resumes a blocked start, except taps on the player controls: those run their own
	// command, and resuming here as well would toggle twice.
	if (!player.waitingForTap || (event.target as Element | null)?.closest?.('.cap-ctrl')) return;
	player.waitingForTap = false;
	void resumeEngine();
}

export function runLocally(command: Command) {
	const effect = applyToQueue(queueState, command, engine.position);
	if (effect !== null) return apply(effect);
	switch (command.kind) {
		case 'togglePlay': {
			const loaded = engine.trackId === queueState.currentTrackId;
			if (!queueState.currentTrackId) return;
			if (engine.playing) {
				engine.pause();
				saveNow();
			} else if (loaded && !player.error && !isRadio(engine.trackId)) void resumeEngine();
			else if (isRadio(queueState.currentTrackId)) void startCurrent(true);
			else void startCurrent(true, loaded ? engine.position : resumeAt.trackId === queueState.currentTrackId ? resumeAt.position : 0);
			return;
		}
		case 'seek':
			engine.seek(Math.min(command.seconds, player.duration || command.seconds));
			refreshPlayback(true);
			return scheduleSave();
		case 'volume':
			player.volume = Math.min(1, Math.max(0, command.volume));
			player.muted = false;
			localStorage.setItem(VOLUME_KEY, String(player.volume));
			applyLevel();
			return refreshPlayback();
		case 'mute':
			player.muted = command.muted;
			applyLevel();
			return refreshPlayback();
		case 'liked':
			setStarred(command.trackId, command.starred);
			return refreshPlayback();
	}
}

export const pauseLocal = () => engine.pause();

export const localPosition = () => engine.position;

// Called when this tab stops mirroring. The position is remembered so that pressing play
// continues where the other device was, even though the engine may not have the track loaded.
export function returnToLocal(position: number) {
	resumeAt = { trackId: queueState.currentTrackId, position };
	if (engine.trackId === resumeAt.trackId) engine.seek(position);
	player.volume = storedVolume();
	player.muted = false;
	player.waitingForTap = false;
	player.playing = engine.playing;
	applyLevel();
}

export async function restoreSavedQueue() {
	if (queueState.currentTrackId) return;
	try {
		const saved = await fetchSavedQueue();
		if (!saved) return;
		const tracks = await tracksByIds(saved.trackIds);
		// The user may have started something, or another device may have become active, while this loaded.
		if (!tracks.length || queueState.currentTrackId || remote.mirroring()) return;
		remember(tracks);
		const known = tracks.map((track) => track.id);
		queue.restoreQueue(queueState, known, Math.max(0, known.indexOf(saved.currentTrackId)), saved.sourceName);
		queueChanged();
		await startCurrent(false, saved.positionSeconds);
	} catch {
		return;
	}
}

export function startPlayback(media: MediaHandlers) {
	applyLevel();
	onReconnect(() => {
		void sendPendingScrobbles();
		saveNow();
	});
	void sendPendingScrobbles();
	setInterval(tick, PLAYBACK.tickMs);
	// Browsers block audio until the page has had a user gesture (e.g. playback handed over to an
	// untouched tab). These three event types are ones iOS counts as a gesture; pointerdown is not.
	for (const type of ['click', 'touchend', 'keydown']) addEventListener(type, onGesture, { capture: true });
	installMediaSession(media);
}

export const sampleAudio = (nowMs: number) => engine.sample(nowMs);

export const localAudioLive = () => engine.live && player.playing;
