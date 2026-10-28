import { describe, expect, it } from 'vitest';
import { GENRE_PLAYLISTS } from '../tuning.ts';
import { withAncestors } from './genres.ts';
import { chooseGenres, pickBest, type GenreSong } from './playlists.ts';

const songs = (genre: string, count: number, artists: number, prefix = genre, fans: number | null = null): GenreSong[] =>
	Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index}`, title: `${prefix} song ${index}`, duration: 200, albumId: `${prefix}-album-${index % artists}`, artistId: `${prefix}-artist-${index % artists}`, genres: withAncestors(genre), plays: 0, starred: false, fans, popularity: null }));

const chosen = (library: GenreSong[]) => chooseGenres(library).map((playlist) => playlist.genre);

const bands: [string, number][] = [
	['Glass Harbor', 12261102],
	['Paper Lanterns', 5818398],
	['Iron Orchard', 2629888],
	['Velvet Static', 2164631],
	['Northbound', 1511423],
	['Copper Sky', 1052044],
	['Low Tide', 203239],
	['Ember Lane', 105676],
	['Quiet Engine', 81983],
	['Salt Choir', 30974]
];

const nuMetal = bands.flatMap(([band, fans]) => Array.from({ length: 12 }, (_, index) => ({ ...songs('Nu Metal', 1, 1, `${band}-${index}`, fans)[0], artistId: band, popularity: (fans / 10) * (1 - index / 20) })));

const perArtist = (picked: GenreSong[]) => Object.fromEntries(bands.map(([band]) => [band, picked.filter((song) => song.artistId === band).length]));

describe('genre playlists', () => {
	it('keeps only the broad genre when a subgenre would repeat it', () => {
		expect(chosen(songs('Nu Metal', 80, 6))).toEqual(['Alternative']);
	});

	it('gives a subgenre its own playlist when it is a distinct slice', () => {
		expect(chosen([...songs('Hip-Hop', 200, 10), ...songs('Trap', 60, 6)])).toEqual(['Hip-Hop', 'Trap']);
	});

	it('skips genres that are too small', () => {
		expect(chosen([...songs('Hip-Hop', 40, 4), ...songs('Classical', 15, 2), ...songs('Jazz', 40, 1)])).toEqual(['Hip-Hop']);
	});

	it('splits songs between artists by dampened popularity', () => {
		expect(perArtist(pickBest(nuMetal, { ...GENRE_PLAYLISTS, songCap: 50 }))).toEqual({
			'Glass Harbor': 8,
			'Paper Lanterns': 7,
			'Iron Orchard': 6,
			'Velvet Static': 6,
			'Northbound': 5,
			'Copper Sky': 5,
			'Low Tide': 4,
			'Ember Lane': 3,
			'Quiet Engine': 3,
			'Salt Choir': 3
		});
	});

	it('splits evenly when nothing is known about popularity', () => {
		const counts = Object.values(Object.groupBy(pickBest(songs('Hip-Hop', 300, 10)), (song) => song.artistId)).map((group) => group!.length);
		expect(counts).toEqual(Array(10).fill(10));
	});

	it('starts with the biggest songs but keeps each artist out of the last three places', () => {
		const picked = pickBest(nuMetal, { ...GENRE_PLAYLISTS, songCap: 50 });
		expect(picked[0].artistId).toBe('Glass Harbor');
		picked.forEach((song, index) => expect(picked.slice(Math.max(0, index - 3), index).map((previous) => previous.artistId)).not.toContain(song.artistId));
	});

	it('plays each song once even when the library has several editions of it', () => {
		const editions = ['Lighthouse', 'Lighthouse (Live)', 'Driftwood', 'Driftwood'].map((title, index) => ({ ...songs('Metal', 1, 1, `edition-${index}`)[0], title, artistId: 'harbor', plays: index }));
		expect(pickBest(editions).map((song) => song.title).toSorted()).toEqual(['Lighthouse (Live)', 'Driftwood']);
	});

	it('prefers the original recording over remixes when nothing else decides', () => {
		const versions = ['Paper Moon (Night Owl club mix)', 'Paper Moon (Sam Rivers mix)', 'Paper Moon', 'Paper Moon - Live'].map((title, index) => ({ ...songs('Nu Metal', 1, 1, `version-${index}`)[0], title, artistId: 'orchard' }));
		expect(pickBest(versions).map((song) => song.title)).toEqual(['Paper Moon']);
	});

	it('does not let a couple of plays lift an obscure song over a hit', () => {
		const velvet = [
			['Open Road', 863266, 0],
			['Northern Lights', 814254, 0],
			['Small Hours', 321967, 2]
		].map(([title, popularity, plays], index) => ({ ...songs('Nu Metal', 1, 1, `velvet-${index}`)[0], title: title as string, artistId: 'velvet', popularity: popularity as number, plays: plays as number }));
		expect(pickBest(velvet, GENRE_PLAYLISTS, 0).map((song) => song.title)).toEqual(['Open Road', 'Northern Lights', 'Small Hours']);
	});

	it('leaves out skits, intros and very short tracks unless they are popular', () => {
		const titles = ['Skittles (skit)', 'Интро', 'Outro', 'Introvert', 'Real song', 'Short one', 'Famous intro'];
		const library = titles.map((title, index) => ({ ...songs('Hip-Hop', 1, 1, `filler-${index}`)[0], title, artistId: 'filler', duration: title === 'Short one' ? 40 : 200, popularity: title === 'Famous intro' ? 500_000 : null }));
		expect(pickBest(library).map((song) => song.title).toSorted()).toEqual(['Famous intro', 'Introvert', 'Real song']);
	});

	it('drops a playlist whose picks mostly repeat another one', () => {
		const shared = songs('Rock', 60, 6, 'shared').map((song) => ({ ...song, genres: ['Rock', 'Electronic'], popularity: 900_000 }));
		const library = [...shared, ...songs('Rock', 100, 6, 'rock'), ...songs('Electronic', 100, 6, 'electronic')].map((song) => ({ ...song, popularity: song.popularity ?? 1_000 }));
		expect(chosen(library)).toHaveLength(1);
	});

	it('gives artists whose catalogue is short their songs and hands the rest to others', () => {
		const library = [...songs('Hip-Hop', 200, 2, 'big'), ...songs('Hip-Hop', 6, 6, 'small')];
		const picked = pickBest(library);
		expect(picked).toHaveLength(GENRE_PLAYLISTS.songCap);
		expect(picked.filter((song) => song.id.startsWith('small'))).toHaveLength(6);
	});
});
