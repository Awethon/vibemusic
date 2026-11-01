import type { Playlist } from '../library/queries.ts';
import { plural, relativeTime } from './format.ts';

export const playlistKindLabel = (playlist: Playlist) =>
	({ own: 'Playlist', smart: 'Smart playlist', genre: 'Genre playlist', artist: 'Artist playlist' })[playlist.kind];

export function playlistMetaLine(playlist: Playlist): string {
	if (playlist.kind === 'genre') return `${plural(playlist.albumCount, 'album')} · ${plural(playlist.songCount, 'track')}`;
	if (playlist.kind === 'artist') return `${plural(playlist.songCount, 'track')} · updated weekly`;
	if (playlist.kind === 'smart')
		return `${plural(playlist.songCount, 'track')}${playlist.updated ? ` · updated ${relativeTime(playlist.updated)}` : ''}`;
	return plural(playlist.songCount, 'track');
}

export const mosaicAlbumIds = (playlist: Playlist) => {
	const ids = playlist.mosaicAlbumIds;
	if (!ids.length) return [];
	// The mosaic always has four tiles; with fewer albums they repeat.
	return ids.length >= 4 ? ids.slice(0, 4) : [0, 1, 2, 3].map((index) => ids[index % ids.length]);
};
