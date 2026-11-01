import sqlite3InitModule, { type Database, type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import { nativeAlbum, nativePlaylist, nativeSong, type NativeAlbum, type NativePlaylist, type NativePlaylistTrack, type NativeSong } from '../navidrome/schemas.ts';
import { applyChanges, buildLibrary, readMeta, readSyncState } from './build.ts';
import { followsListening } from './fetch.ts';
import type { LibraryChanges, LibrarySnapshot } from './snapshot.ts';

const USER = 'u1';
const GENRES = ['Rock', 'Jazz', 'Electronic'];

let sqlite: Sqlite3Static;
beforeAll(async () => {
	sqlite = await sqlite3InitModule();
});

function library(): LibrarySnapshot {
	const albums: NativeAlbum[] = [];
	const songs: NativeSong[] = [];
	for (let artist = 0; artist < 12; artist++) {
		const genre = GENRES[artist % GENRES.length];
		for (let record = 0; record < 4; record++) {
			const albumId = `al-${artist}-${record}`;
			albums.push(nativeAlbum.parse({ id: albumId, name: `Record ${artist}.${record}`, albumArtistId: `ar-${artist}`, albumArtist: `Artist ${artist}`, maxYear: 1990 + record, genre, genres: [{ name: genre }], songCount: 10, duration: 2000, createdAt: '2026-01-01T00:00:00Z', importedAt: '2026-01-01T00:00:00Z', participants: { albumartist: [{ id: `ar-${artist}`, name: `Artist ${artist}` }] } }));
			for (let track = 0; track < 10; track++) {
				songs.push(nativeSong.parse({ id: `s-${artist}-${record}-${track}`, albumId, title: `Song ${artist}.${record}.${track}`, artist: `Artist ${artist}`, artistId: `ar-${artist}`, trackNumber: track + 1, discNumber: 1, duration: 200, genre, genres: [{ name: genre }], playCount: (artist * 7 + track * 3) % 11 }));
			}
		}
	}
	const playlists = [
		nativePlaylist.parse({ id: 'pl-own', name: 'Mix', ownerId: USER, songCount: 3, updatedAt: '2026-02-01T00:00:00Z' }),
		nativePlaylist.parse({ id: 'pl-smart', name: 'Most played', ownerId: USER, rules: { all: [{ gt: { playcount: 5 } }], sort: 'playcount' }, evaluatedAt: '2026-02-01T00:00:00Z' }),
		nativePlaylist.parse({ id: 'pl-this', name: 'This is Artist 3', ownerId: 'relay', songCount: 2, updatedAt: '2026-02-01T00:00:00Z' })
	];
	const playlistTracks = new Map<string, NativePlaylistTrack[]>([
		['pl-own', ['s-0-0-0', 's-1-0-1', 's-2-0-2'].map((id, index) => ({ id: String(index), mediaFileId: id }))],
		['pl-smart', ['s-5-1-1', 's-6-2-2'].map((id, index) => ({ id: String(index), mediaFileId: id }))],
		['pl-this', ['s-3-0-0', 's-3-1-1'].map((id, index) => ({ id: String(index), mediaFileId: id }))]
	]);
	return { albums, songs, playlists, playlistTracks, radioStations: [] };
}

function built(snapshot: LibrarySnapshot): Database {
	const db = new sqlite.oo1.DB();
	buildLibrary(db, snapshot, USER, '2026-03-01T00:00:00Z');
	return db;
}

function changesFor(base: LibrarySnapshot, next: LibrarySnapshot, refetched: string[]): LibraryChanges {
	const before = new Map(base.songs.map((song) => [song.id, song]));
	const albumsBefore = new Map(base.albums.map((album) => [album.id, album]));
	return {
		marks: { albumImported: '', albumPlayed: '', albumStarred: '', songPlayed: '', songStarred: '' },
		albums: [],
		albumSongs: [],
		albumStats: [],
		artwork: next.albums.filter((album) => JSON.stringify(album) !== JSON.stringify(albumsBefore.get(album.id))),
		songStats: next.songs.filter((song) => JSON.stringify(song) !== JSON.stringify(before.get(song.id))),
		ratings: new Map(),
		playlists: next.playlists,
		playlistTracks: new Map(refetched.map((id) => [id, next.playlistTracks.get(id) ?? []])),
		radioStations: [],
		totals: null
	};
}

function applied(base: LibrarySnapshot, next: LibrarySnapshot, refetched: string[]) {
	const db = built(base);
	const before = sqlite.capi.sqlite3_js_db_export(db);
	const result = applyChanges(db, readMeta(db)!, readSyncState(db)!, changesFor(base, next, refetched), '2026-03-02T00:00:00Z');
	const after = sqlite.capi.sqlite3_js_db_export(db);
	let changedPages = 0;
	for (let page = 0; page < after.length; page += 4096) {
		for (let offset = page; offset < Math.min(after.length, page + 4096); offset++) {
			if (after[offset] !== before[offset]) {
				changedPages += 1;
				break;
			}
		}
	}
	return { db, changed: result.changed, changedPages, pages: Math.ceil(after.length / 4096) };
}

const TABLES = {
	playlist: 'select * from playlist order by id',
	playlist_track: 'select * from playlist_track order by playlist_id, position',
	search: 'select kind, ref, text from search order by kind, ref',
	search_key: 'select kind, ref, text from search_key order by kind, ref',
	track: 'select id, play_count, starred from track order by id'
};

function expectSameLibrary(actual: Database, expected: Database) {
	for (const [table, sql] of Object.entries(TABLES)) expect(actual.selectArrays(sql), table).toEqual(expected.selectArrays(sql));
}

function withSongs(snapshot: LibrarySnapshot, change: (song: NativeSong) => NativeSong): LibrarySnapshot {
	return { ...snapshot, songs: snapshot.songs.map(change) };
}

describe('applyChanges', () => {
	it('matches a full rebuild after stars and plays, and rewrites little', () => {
		const base = library();
		const next = withSongs(base, (song) => (song.id === 's-4-1-3' ? { ...song, starred: true } : song.id.startsWith('s-7-') ? { ...song, playCount: song.playCount + 40 } : song));
		const result = applied(base, next, []);
		expect(result.changed).toBe(true);
		expectSameLibrary(result.db, built(next));
		expect(result.changedPages / result.pages).toBeLessThan(0.25);
	});

	it('leaves playlists alone when a refetched smart playlist comes back unchanged', () => {
		const base = library();
		const next = withSongs(base, (song) => (song.id === 's-0-0-0' ? { ...song, starred: true } : song));
		const withRefetch = applied(base, next, ['pl-smart']);
		const withoutRefetch = applied(base, next, []);
		expectSameLibrary(withRefetch.db, built(next));
		expect(withRefetch.changedPages).toBe(withoutRefetch.changedPages);
	});

	it('replaces a smart playlist whose tracks changed', () => {
		const base = library();
		const next: LibrarySnapshot = { ...base, playlistTracks: new Map([...base.playlistTracks, ['pl-smart', ['s-8-0-0', 's-5-1-1', 's-9-3-9'].map((id, index) => ({ id: String(index), mediaFileId: id }))]]) };
		const result = applied(base, next, ['pl-smart']);
		expect(result.changed).toBe(true);
		expectSameLibrary(result.db, built(next));
	});

	it('handles renamed, removed and new playlists, including a new "This is" playlist', () => {
		const base = library();
		const renamed = base.playlists.map((playlist): NativePlaylist => (playlist.id === 'pl-own' ? { ...playlist, name: 'Weekend mix', updatedAt: '2026-02-05T00:00:00Z' } : playlist)).filter((playlist) => playlist.id !== 'pl-this');
		const added = nativePlaylist.parse({ id: 'pl-this-6', name: 'This is Artist 6', ownerId: 'relay', songCount: 1, updatedAt: '2026-02-05T00:00:00Z' });
		const tracks = new Map(base.playlistTracks);
		tracks.delete('pl-this');
		tracks.set('pl-this-6', [{ id: '0', mediaFileId: 's-6-0-0' }]);
		const next: LibrarySnapshot = { ...base, playlists: [...renamed, added], playlistTracks: tracks };
		const result = applied(base, next, ['pl-own', 'pl-this-6']);
		expectSameLibrary(result.db, built(next));
		expect(result.db.selectValue("select kind || ':' || artist_id from playlist where id = 'pl-this-6'")).toBe('artist:ar-6');
	});

	it('updates a new cover without rebuilding anything', () => {
		const base = library();
		const next: LibrarySnapshot = { ...base, albums: base.albums.map((album) => (album.id === 'al-2-1' ? { ...album, imageHash: '0123456789abcdef', dominantColor: '#336699' } : album)) };
		const result = applied(base, next, []);
		expect(result.changed).toBe(true);
		expectSameLibrary(result.db, built(next));
		expect(result.db.selectValue("select image_hash || ' ' || dominant_color from album where id = 'al-2-1'")).toBe('0123456789abcdef #336699');
		expect(result.changedPages / result.pages).toBeLessThan(0.05);
	});

	it('reports nothing changed when nothing did', () => {
		const base = library();
		const result = applied(base, base, ['pl-smart']);
		expect(result.changed).toBe(false);
		expectSameLibrary(result.db, built(base));
	});
});

describe('followsListening', () => {
	it('spots rules that depend on plays, likes or ratings', () => {
		expect(followsListening({ all: [{ gt: { playcount: 5 } }] })).toBe(true);
		expect(followsListening({ all: [{ is: { loved: true } }] })).toBe(true);
		expect(followsListening({ all: [{ inTheLast: { dateadded: 60 } }], sort: 'lastPlayed', order: 'desc' })).toBe(true);
		expect(followsListening({ any: [{ gt: { albumRating: 3 } }] })).toBe(true);
	});

	it('ignores rules that only depend on the files', () => {
		expect(followsListening({ all: [{ gt: { duration: 420 } }], sort: 'random', limit: 60 })).toBe(false);
		expect(followsListening({ all: [{ inTheLast: { dateadded: 60 } }], sort: 'dateadded', order: 'desc', limit: 120 })).toBe(false);
	});
});
