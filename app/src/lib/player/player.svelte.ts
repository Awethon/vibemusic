import { rememberPlayedList } from '../history.svelte.ts';
import { patchLibrary } from '../library/library.svelte.ts';
import type { Track } from '../library/queries.ts';
import { navidrome } from '../session.svelte.ts';
import { localAudioLive, startPlayback } from './playback.svelte.ts';
import type * as queue from './queue.ts';
import { isMirroring, perform } from './remote.svelte.ts';
import { player, queueState, remember, setStarred } from './state.svelte.ts';

export { currentTrack, player, playerQueue, totalDuration, trackById } from './state.svelte.ts';
export { restoreSavedQueue, sampleAudio } from './playback.svelte.ts';
export { playOn, startRemoteControl } from './remote.svelte.ts';

export function startPlayer() {
	startPlayback({
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
	setStarred(track.id, starred);
	perform({ kind: 'liked', trackId: track.id, starred });
}

export async function toggleDislike(track: Track) {
	const disliked = !track.disliked;
	await navidrome().subsonic('setRating', { id: track.id, rating: disliked ? 1 : 0 });
	await patchLibrary('update track set rating = ? where id = ?', [disliked ? 1 : 0, track.id]);
}

export const audioLive = () => !isMirroring() && localAudioLive();
