import { isUnreachable } from '../connection.svelte.ts';
import { patchLibrary } from '../library/library.svelte.ts';
import type { Track } from '../library/queries.ts';
import { navidrome, requireCredentials } from '../session.svelte.ts';
import { SCROBBLE } from '../tuning.ts';

const PENDING_SCROBBLES_KEY = 'vibemusic.pendingScrobbles';

type PendingScrobble = { trackId: string; albumId: string; time: number };

let listenedSeconds = 0;
let scrobbled = false;

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
	await patchLibrary('update track set play_count = play_count + 1, play_date = max(play_date, ?) where id = ?', [
		playedAt,
		scrobble.trackId
	]);
	await patchLibrary('update album set play_count = play_count + 1, play_date = max(play_date, ?) where id = ?', [
		playedAt,
		scrobble.albumId
	]);
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

export function announceNowPlaying(trackId: string) {
	void navidrome()
		.subsonic('scrobble', { id: trackId, submission: 'false' })
		.catch(() => {});
}

export function resetListening() {
	listenedSeconds = 0;
	scrobbled = false;
}

export function listened(track: Track, seconds: number, durationSeconds: number) {
	listenedSeconds += Math.min(seconds, SCROBBLE.maxTickSeconds);
	if (scrobbled || durationSeconds < SCROBBLE.minTrackSeconds) return;
	if (listenedSeconds >= Math.min(durationSeconds / 2, SCROBBLE.afterSeconds)) void submitScrobble(track);
}

export async function sendPendingScrobbles() {
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
