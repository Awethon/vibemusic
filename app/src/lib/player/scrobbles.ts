// Scrobbling to Navidrome: "now playing" on start, a play once enough of the track was heard.
// Plays made while Navidrome is unreachable wait in localStorage (per user) and are sent later.

import { isUnreachable } from '../connection.svelte.ts';
import { patchLibrary } from '../library/library.svelte.ts';
import type { Track } from '../library/queries.ts';
import { navidrome, requireCredentials } from '../session.svelte.ts';
import { SCROBBLE } from '../tuning.ts';

const PENDING_SCROBBLES_KEY = 'vibemusic.pendingScrobbles';

type PendingScrobble = { trackId: string; albumId: string; time: number };

let listenedSeconds = 0;
let scrobbled = false;
// Listening time before which a scrobble Navidrome refused is not tried again.
let retryAtSeconds = 0;
// Counts tracks, so an answer that arrives after the track changed is not applied to the next one.
let listening = 0;

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
	// Mirror the new play count in the local library copy so it shows without a resync. Navidrome
	// has the play by now, so a failure here must not look like a failed scrobble: sending it again
	// would count the play twice. The next sync brings the right count.
	try {
		await patchLibrary('update track set play_count = play_count + 1, play_date = max(play_date, ?) where id = ?', [
			playedAt,
			scrobble.trackId
		]);
		await patchLibrary('update album set play_count = play_count + 1, play_date = max(play_date, ?) where id = ?', [
			playedAt,
			scrobble.albumId
		]);
	} catch {
		// Left to the next sync.
	}
}

async function submitScrobble(track: Track) {
	scrobbled = true;
	const current = listening;
	const scrobble = { trackId: track.id, albumId: track.albumId, time: Date.now() };
	try {
		await sendScrobble(scrobble);
	} catch (error) {
		// Network failures are kept for later. Anything else is Navidrome refusing it: try again
		// after some more listening, not on the next tick, which comes many times a second.
		if (isUnreachable(error)) keepPendingScrobbles([...pendingScrobbles(), scrobble]);
		else if (current === listening) {
			retryAtSeconds = listenedSeconds + SCROBBLE.retryAfterSeconds;
			scrobbled = false;
		}
	}
}

export function announceNowPlaying(trackId: string) {
	void navidrome()
		.subsonic('scrobble', { id: trackId, submission: 'false' })
		.catch(() => {});
}

export function resetListening() {
	listenedSeconds = 0;
	scrobbled = false;
	retryAtSeconds = 0;
	listening += 1;
}

export function listened(track: Track, seconds: number, durationSeconds: number) {
	// Capped so a long pause between ticks (sleep, throttled background timers) doesn't count as listening.
	listenedSeconds += Math.min(seconds, SCROBBLE.maxTickSeconds);
	if (scrobbled || durationSeconds < SCROBBLE.minTrackSeconds || listenedSeconds < retryAtSeconds) return;
	// The usual scrobble rule: half the track or 4 minutes, whichever comes first.
	if (listenedSeconds >= Math.min(durationSeconds / 2, SCROBBLE.afterSeconds)) void submitScrobble(track);
}

export async function sendPendingScrobbles() {
	const waiting = pendingScrobbles();
	while (waiting.length) {
		try {
			await sendScrobble(waiting[0]);
		} catch (error) {
			if (isUnreachable(error)) break;
			// Any other error means the server rejected it; drop it rather than block the rest forever.
		}
		waiting.shift();
		keepPendingScrobbles(waiting);
	}
}
