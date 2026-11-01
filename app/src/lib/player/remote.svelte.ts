// Remote control between tabs. Each browser tab is a device; at most one is active: it plays,
// owns the queue and publishes queue + playback through the relay. The others mirror that state
// (no local audio) and send their commands to it. "Play here" hands over queue and position.

import { deviceLabel } from '../remote/devices.ts';
import { activeIsOnline, isActiveElsewhere, relay, sendToRelay, startRelay, type RelayMessage } from '../remote/relay.svelte.ts';
import { REMOTE } from '../tuning.ts';
import { showToast } from '../ui/state.svelte.ts';
import { applyToQueue, STARTS_PLAYBACK, type Command } from './commands.ts';
import { updateMediaSession } from './mediaSession.ts';
import { connectRemote, localPosition, pauseLocal, returnToLocal, runLocally, startCurrent } from './playback.svelte.ts';
import * as queue from './queue.ts';
import { currentTrack, ensureTracks, onQueueChange, player, queueChanged, queueState, setStarred } from './state.svelte.ts';

type Playback = {
	trackId: string;
	playing: boolean;
	position: number;
	duration: number;
	volume: number;
	muted: boolean;
	starred: boolean;
	waiting: boolean;
};

let mirroring = false;
// Mirrored position is extrapolated locally between playback messages from this base.
let mirroredAt = 0;
let mirroredPosition = 0;
let mirrorSequence = 0;
let publishedSignature = '';
let publishedAt = 0;
let publishedPosition = 0;
let announced = false;
// Blocks announcing while a takeover is still loading the new queue, so the stale queue isn't published.
let takingOver = false;
let queuePublishTimer: ReturnType<typeof setTimeout> | undefined;

const publishing = () => relay.connected && relay.active === relay.deviceId;

export const isMirroring = () => mirroring;

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

// Position is left out because it changes every tick; jumps are caught by positionJumped and
// steady progress is extrapolated by the mirrors.
function playbackSignature() {
	const { trackId, playing, duration, volume, muted, starred, waiting } = playbackSnapshot();
	return [trackId, playing, Math.round(duration), volume, muted, starred, waiting].join('|');
}

function positionJumped() {
	const expected = publishedPosition + (player.playing ? (Date.now() - publishedAt) / 1000 : 0);
	return Math.abs(player.position - expected) > REMOTE.positionJumpSeconds;
}

function publishPlayback() {
	publishedSignature = playbackSignature();
	publishedAt = Date.now();
	publishedPosition = player.position;
	sendToRelay({ type: 'playback', playback: playbackSnapshot() });
}

function publishQueue() {
	if (publishing()) sendToRelay({ type: 'queue', queue: queue.copyQueue(queueState) });
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

function moveMirrorClock(playing: boolean, position: number) {
	player.playing = playing;
	mirroredPosition = position;
	mirroredAt = performance.now();
	player.position = position;
}

async function mirrorQueue(snapshot: queue.QueueState | null) {
	if (!snapshot) return;
	// Track details load asynchronously; a newer snapshot (or leaving mirror mode) wins over this one.
	const sequence = ++mirrorSequence;
	await ensureTracks(queue.queuedTrackIds(snapshot));
	if (sequence !== mirrorSequence || !mirroring) return;
	queue.replaceQueue(queueState, snapshot);
	queueChanged();
}

function mirrorPlayback(playback: Playback | null, ageMs: number) {
	if (!playback) return;
	// ageMs is how long ago the active device reported this playback; advance the position by it
	// so the mirror shows where the active device actually is.
	const playing = playback.playing && activeIsOnline();
	moveMirrorClock(playing, playback.position + (playing ? ageMs / 1000 : 0));
	player.buffering = false;
	player.duration = playback.duration;
	player.volume = playback.volume;
	player.muted = playback.muted;
	player.waitingForTap = playback.waiting && activeIsOnline();
	setStarred(playback.trackId, playback.starred);
}

function enterMirror() {
	if (mirroring) return;
	mirroring = true;
	pauseLocal();
	clearTimeout(queuePublishTimer);
}

function leaveMirror() {
	if (!mirroring) return;
	mirroring = false;
	returnToLocal(player.position);
}

// Applies a command to the mirrored state right away so the UI responds before the active
// device's update comes back; that update then overwrites the prediction.
function predict(command: Command) {
	const effect = applyToQueue(queueState, command, player.position);
	if (effect !== null) {
		queueChanged();
		if (effect === 'play' || effect === 'restart') moveMirrorClock(true, 0);
		return;
	}
	switch (command.kind) {
		case 'togglePlay':
			return moveMirrorClock(!player.playing, player.position);
		case 'seek':
			return moveMirrorClock(player.playing, command.seconds);
		case 'volume':
			player.volume = command.volume;
			player.muted = false;
			return;
		case 'mute':
			player.muted = command.muted;
			return;
	}
}

export function perform(command: Command) {
	if (mirroring && activeIsOnline()) {
		sendToRelay({ type: 'command', command });
		predict(command);
		return;
	}
	// The active device is offline (or there is none): play here and tell the relay this tab is active now.
	if (STARTS_PLAYBACK.has(command.kind) && relay.connected && relay.active !== relay.deviceId) {
		leaveMirror();
		sendToRelay({ type: 'claim' });
	}
	runLocally(command);
}

async function obey(command: Command) {
	if ('trackIds' in command) await ensureTracks(command.trackIds);
	runLocally(command);
}

// Becomes the active device with the given queue and playback ("Play here" handoff, or adopting
// the state of an active device that went offline).
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
	if (playing && !player.waitingForTap) showToast('Playing in this tab');
}

const activeIsOffline = () => relay.connected && !!relay.active && relay.active !== relay.deviceId && !activeIsOnline();

// Takes over from an active device that went offline, but paused: nobody asked this tab to play.
function adopt(snapshot: queue.QueueState | null, playback: Playback | null) {
	return takeOver(snapshot, playback && { ...playback, playing: false }, 0);
}

// The relay says another device is now active. With handoff, this tab sends its queue and exact
// position so the other device continues seamlessly.
function release(to: string, handoff: boolean) {
	const playback = { ...playbackSnapshot(), position: localPosition() || player.position };
	pauseLocal();
	if (handoff) sendToRelay({ type: 'handoff', to, queue: queue.copyQueue(queueState), playback });
	enterMirror();
	mirrorPlayback({ ...playback, playing: handoff && playback.playing }, 0);
	const name = deviceLabel(to);
	if (handoff && name) showToast(`Moved playback to ${name}`);
}

function onRelayMessage(message: RelayMessage) {
	switch (message.type) {
		case 'welcome':
			announced = false;
			if (isActiveElsewhere()) {
				enterMirror();
				void mirrorQueue(message.queue as queue.QueueState | null);
				mirrorPlayback(message.playback as Playback | null, message.ageMs);
			} else if (activeIsOffline()) void adopt(message.queue as queue.QueueState | null, message.playback as Playback | null);
			else if (!relay.active && player.playing) sendToRelay({ type: 'claim' });
			announceIfActive();
			return;
		case 'devices':
			if (isActiveElsewhere()) enterMirror();
			else if (mirroring && activeIsOffline()) void adopt(queue.copyQueue(queueState), playbackSnapshot());
			else if (mirroring) leaveMirror();
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

function ticked(nowMs: number) {
	if (mirroring) {
		if (player.playing) player.position = Math.min(player.duration || Infinity, mirroredPosition + (nowMs - mirroredAt) / 1000);
		updateMediaSession(currentTrack(), player.playing, player.position, player.duration);
	} else if (publishing() && player.playing && Date.now() - publishedAt > REMOTE.playbackResyncMs) publishPlayback(); // corrects mirror drift
}

function refreshed(force: boolean) {
	if (publishing() && (force || playbackSignature() !== publishedSignature || positionJumped())) publishPlayback();
}

onQueueChange(() => {
	if (!publishing()) return;
	clearTimeout(queuePublishTimer);
	// Short debounce: one user action can change the queue several times in a row.
	queuePublishTimer = setTimeout(publishQueue, REMOTE.queuePublishDelayMs);
});

connectRemote({ mirroring: isMirroring, refreshed, ticked });

export function startRemoteControl() {
	void startRelay(onRelayMessage);
}

export function playOn(deviceId: string) {
	if (deviceId === relay.active) return;
	// The active device is gone and can't hand over, so take its last known state directly.
	if (deviceId === relay.deviceId && !activeIsOnline()) {
		void takeOver(queue.copyQueue(queueState), { ...playbackSnapshot(), playing: true }, 0);
		sendToRelay({ type: 'claim' });
		return;
	}
	sendToRelay({ type: 'transfer', to: deviceId });
}
