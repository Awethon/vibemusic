import { describe, expect, it } from 'vitest';
import { GENRE_PLAYLISTS } from '../tuning.ts';
import { withAncestors } from './genres.ts';
import { chooseGenres, pickBest, type GenreSong } from './playlists.ts';

const songs = (genre: string, count: number, artists: number, prefix = genre): GenreSong[] =>
	Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index}`, albumId: `${prefix}-album-${index % artists}`, artistId: `${prefix}-artist-${index % artists}`, genres: withAncestors(genre), plays: index, albumPlays: 0, starred: false }));

const chosen = (library: GenreSong[]) => chooseGenres(library).map((playlist) => playlist.genre);

describe('genre playlists', () => {
	it('keeps only the broad genre when a subgenre would repeat it', () => {
		expect(chosen(songs('Nu Metal', 80, 6))).toEqual(['Alternative']);
	});

	it('gives a subgenre its own playlist when it is a distinct slice', () => {
		const library = [...songs('Hip-Hop', 200, 10), ...songs('Trap', 60, 6)];
		expect(chosen(library)).toEqual(['Hip-Hop', 'Trap']);
	});

	it('skips genres that are too small', () => {
		expect(chosen([...songs('Hip-Hop', 40, 4), ...songs('Classical', 15, 2), ...songs('Jazz', 40, 1)])).toEqual(['Hip-Hop']);
	});

	it('gives every artist a share, fills up with the most played, never the same artist twice in a row', () => {
		const library = [...songs('Hip-Hop', 300, 2, 'big'), ...songs('Hip-Hop', 30, 6, 'small')];
		const picked = pickBest(library);
		expect(picked).toHaveLength(GENRE_PLAYLISTS.songCap);
		expect(picked.filter((song) => song.id.startsWith('small'))).toHaveLength(30);
		expect(picked.slice(0, 20).some((song, index) => index > 0 && song.artistId === picked[index - 1].artistId)).toBe(false);
	});
});
