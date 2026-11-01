import { describe, expect, it } from 'vitest';
import { genresFromEvidence, type Evidence } from './evidence.ts';
import { createGenreResolver } from './genres.ts';

const genres = (evidence: Partial<Evidence>) =>
	genresFromEvidence(createGenreResolver(), { fileGenres: [], albumTags: null, artistTags: null, ...evidence });

describe('genres from evidence', () => {
	it('fills untagged albums from MusicBrainz, keeping only well-supported tags', () => {
		expect(
			genres({
				albumTags: [
					['nu metal', 4],
					['heavy metal', 1],
					['industrial metal', 1],
					['rock', 1]
				]
			})
		).toEqual(['Nu Metal']);
		expect(
			genres({
				albumTags: [
					['idm', 9],
					['drill and bass', 5],
					['electroacoustic', 2],
					['acid techno', 1]
				]
			})
		).toEqual(['IDM']);
	});

	it('lets a second MusicBrainz genre in when the file tags agree with it', () => {
		expect(
			genres({
				fileGenres: ['Drill and Bass'],
				albumTags: [
					['idm', 9],
					['drill and bass', 5]
				]
			})
		).toEqual(['Drill and Bass', 'IDM']);
	});

	it('keeps file tags and ignores tags that are not genres', () => {
		expect(
			genres({
				fileGenres: ['Rap'],
				albumTags: [
					['seen live', 9],
					['russian rap', 3]
				]
			})
		).toEqual(['Hip-Hop', 'Russian Hip-Hop']);
	});

	it('uses the store genre to fill an untagged album, never to outvote tags', () => {
		expect(genres({ storeGenre: 'Hip-Hop' })).toEqual(['Hip-Hop']);
		expect(genres({ fileGenres: ['Rock'], storeGenre: 'Pop' })).toEqual(['Rock']);
		expect(genres({ albumTags: [['nu metal', 4]], storeGenre: 'Rock' })).toEqual(['Nu Metal']);
	});

	it('falls back to the artist only when the song and album say nothing', () => {
		expect(
			genres({
				artistTags: [
					['ambient', 9],
					['electronic', 6],
					['game soundtrack', 4],
					['british', 12]
				]
			})
		).toEqual(['Ambient']);
		expect(genres({ fileGenres: ['Rock'], artistTags: [['ambient', 9]] })).toEqual(['Rock']);
	});
});
