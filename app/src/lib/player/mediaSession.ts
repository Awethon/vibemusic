import type { Track } from '../library/queries.ts';
import { coverUrl } from '../navidrome/credentials.ts';
import { session } from '../session.svelte.ts';

type Handlers = { play(): void; pause(): void; next(): void; previous(): void; seek(seconds: number): void };

const ARTWORK_SIZE = 512;
let shownTrackId = '';

export function installMediaSession(handlers: Handlers) {
	if (!('mediaSession' in navigator)) return;
	const media = navigator.mediaSession;
	media.setActionHandler('play', handlers.play);
	media.setActionHandler('pause', handlers.pause);
	media.setActionHandler('nexttrack', handlers.next);
	media.setActionHandler('previoustrack', handlers.previous);
	media.setActionHandler('seekto', (details) => {
		if (details.seekTime !== undefined) handlers.seek(details.seekTime);
	});
}

export function updateMediaSession(track: Track | null, playing: boolean, position: number, duration: number) {
	if (!('mediaSession' in navigator)) return;
	const media = navigator.mediaSession;
	media.playbackState = track ? (playing ? 'playing' : 'paused') : 'none';
	if (track && track.id !== shownTrackId && session.credentials) {
		shownTrackId = track.id;
		media.metadata = new MediaMetadata({
			title: track.title,
			artist: track.artist,
			album: track.album,
			artwork: [{ src: coverUrl(session.credentials, track.albumId, ARTWORK_SIZE), sizes: `${ARTWORK_SIZE}x${ARTWORK_SIZE}` }]
		});
	}
	if (track && duration > 0 && position <= duration) media.setPositionState({ duration, position, playbackRate: 1 });
}
