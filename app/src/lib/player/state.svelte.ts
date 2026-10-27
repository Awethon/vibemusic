import { tracksByIds, type Track } from '../library/queries.ts';
import { PLAYBACK } from '../tuning.ts';
import * as queue from './queue.ts';

export const VOLUME_KEY = 'vibemusic.volume';

export const storedVolume = () => Number(localStorage.getItem(VOLUME_KEY) ?? PLAYBACK.initialVolume);

export const queueState = queue.emptyQueue();
const trackCache = new Map<string, Track>();
const queueListeners: (() => void)[] = [];

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

export const onQueueChange = (listener: () => void) => void queueListeners.push(listener);

export function queueChanged() {
	player.queueRevision += 1;
	for (const listener of queueListeners) listener();
}

export function remember(tracks: Track[]) {
	let added = false;
	for (const track of tracks) {
		if (trackCache.get(track.id) === track) continue;
		trackCache.set(track.id, track);
		added = true;
	}
	if (added) player.trackRevision += 1;
}

export async function ensureTracks(trackIds: string[]) {
	const missing = trackIds.filter((trackId) => !trackCache.has(trackId));
	if (missing.length) remember(await tracksByIds(missing));
}

export function setStarred(trackId: string, starred: boolean) {
	const cached = trackCache.get(trackId);
	if (!cached || cached.starred === starred) return;
	trackCache.set(trackId, { ...cached, starred });
	player.trackRevision += 1;
}
