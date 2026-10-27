import type { Database } from '@sqlite.org/sqlite-wasm';
import type { NativeAlbum, NativePlaylist, NativePlaylistTrack, NativeSong } from '../navidrome/schemas.ts';
import { createGenreResolver, withAncestors, type GenreResolver } from '../genres/genres.ts';
import { chooseGenres, type GenreSong } from '../genres/playlists.ts';
import { normalizeForSearch, SCHEMA, SCHEMA_VERSION } from './schema.ts';
import type { LibraryChanges, LibraryMeta, LibrarySnapshot, SyncState } from './snapshot.ts';

const albumCreditsOf = (album: NativeAlbum) => {
	const credited = album.participants.filter((artist) => artist.id && artist.name);
	if (!credited.length) return album.albumArtistId ? [{ id: album.albumArtistId, name: album.albumArtist, order: album.orderAlbumArtistName || album.albumArtist.toLowerCase() }] : [];
	return credited.map((artist) => ({
		id: artist.id,
		name: artist.name,
		order: credited.length === 1 && album.orderAlbumArtistName ? album.orderAlbumArtistName : artist.name.toLowerCase()
	}));
};

const albumGenresOf = (album: NativeAlbum) => {
	const names = album.genres.map((genre) => genre.name).filter(Boolean);
	return names.length ? [...new Set(names)] : album.genre ? [album.genre] : [];
};

const ARTIST_PLAYLIST_PREFIX = 'This is ';

export const genrePlaylistId = (genre: string) => 'genre-' + genre.toLowerCase().replace(/[^a-z0-9а-яё]+/g, '-');

export const newest = (values: string[]) => values.reduce((latest, value) => (value && (!latest || Date.parse(value) > Date.parse(latest)) ? value : latest), '');

export function playlistSignature(playlist: NativePlaylist) {
	return playlist.rules ? `smart:${playlist.uploadedImage}` : `${playlist.updatedAt}:${playlist.songCount}:${playlist.uploadedImage}`;
}

function eachBound(db: Database, sql: string, rows: (string | number)[][]) {
	if (!rows.length) return;
	const statement = db.prepare(sql);
	for (const row of rows) statement.bind(row).stepReset();
	statement.finalize();
}

function deleteWhereIn(db: Database, sql: string, ids: string[]) {
	eachBound(db, sql, ids.map((id) => [id]));
}

function insertAlbums(db: Database, albums: NativeAlbum[]) {
	eachBound(db, 'insert into album values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', albums.map((album) => [album.id, album.name, album.orderAlbumName || album.name.toLowerCase(), album.albumArtistId, album.albumArtist, album.orderAlbumArtistName || album.albumArtist.toLowerCase(), album.maxYear, JSON.stringify(albumGenresOf(album)), album.songCount, album.duration, album.createdAt, album.updatedAt, album.playCount, album.playDate, album.starred ? 1 : 0]));
	eachBound(db, 'insert or ignore into album_credit values (?,?,?,?,?)', albums.flatMap((album) => albumCreditsOf(album).map((credit, position) => [credit.id, album.id, position, credit.name, credit.order])));
	eachBound(db, 'insert into search values (?,?,?)', albums.map((album) => ['album', album.id, normalizeForSearch(`${album.name} ${album.albumArtist}`)]));
}

function removeAlbums(db: Database, ids: string[]) {
	deleteWhereIn(db, 'delete from album where id = ?', ids);
	deleteWhereIn(db, 'delete from album_credit where album_id = ?', ids);
	deleteWhereIn(db, "delete from search where kind = 'album' and ref = ?", ids);
	const trackIds = ids.flatMap((id) => db.selectValues('select id from track where album_id = ?', [id]) as string[]);
	removeTracks(db, trackIds);
}

const songGenresOf = (song: NativeSong) => {
	const names = song.genres.map((genre) => genre.name).filter(Boolean);
	return names.length ? names : song.genre ? [song.genre] : [];
};

function insertTracks(db: Database, songs: NativeSong[], albums: NativeAlbum[], resolver: GenreResolver) {
	eachBound(db, 'insert or ignore into track values (?,?,?,?,?,?,?,?,?,?,?,?,?)', songs.map((song) => [song.id, song.albumId, song.title, song.artist, song.artistId, song.trackNumber, song.discNumber, song.duration, song.suffix, song.bitRate, song.playCount, song.playDate, song.starred ? 1 : 0]));
	const albumGenres = new Map(albums.map((album) => [album.id, albumGenresOf(album)]));
	eachBound(
		db,
		'insert or ignore into track_genre values (?,?,?)',
		songs.flatMap((song) => {
			const raw = songGenresOf(song);
			const direct = resolver.genresOf(raw.length ? raw : (albumGenres.get(song.albumId) ?? []));
			const broader = direct.flatMap(withAncestors).filter((genre) => !direct.includes(genre));
			return [...direct.map((genre) => [genre, song.id, 1]), ...broader.map((genre) => [genre, song.id, 0])];
		})
	);
	eachBound(db, 'insert into search values (?,?,?)', songs.map((song) => ['track', song.id, normalizeForSearch(`${song.title} ${song.artist}`)]));
}

function removeTracks(db: Database, ids: string[]) {
	deleteWhereIn(db, 'delete from track where id = ?', ids);
	deleteWhereIn(db, 'delete from track_genre where track_id = ?', ids);
	deleteWhereIn(db, "delete from search where kind = 'track' and ref = ?", ids);
}

function updateStats(db: Database, table: 'album' | 'track', rows: { id: string; playCount: number; playDate: string; starred: boolean }[]): number {
	if (!rows.length) return 0;
	const counted = db.prepare(`update ${table} set play_count = ?, starred = ? where id = ? and (play_count != ? or starred != ?)`);
	const dated = db.prepare(`update ${table} set play_date = ? where id = ?`);
	let changed = 0;
	for (const row of rows) {
		const starred = row.starred ? 1 : 0;
		counted.bind([row.playCount, starred, row.id, row.playCount, starred]).stepReset();
		changed += db.changes();
		dated.bind([row.playDate, row.id]).stepReset();
	}
	counted.finalize();
	dated.finalize();
	return changed;
}

function insertPlaylists(db: Database, playlists: NativePlaylist[]) {
	eachBound(db, 'insert into playlist values (?,?,?,?,?,?,?,?,?,?,?,?)', playlists.map((playlist) => [playlist.id, playlist.name, playlist.rules ? 'smart' : 'own', playlist.ownerId, '', 0, 0, playlist.duration, playlist.evaluatedAt || playlist.updatedAt, playlist.uploadedImage, playlist.sync ? 1 : 0, '']));
	eachBound(db, 'insert into search values (?,?,?)', playlists.map((playlist) => ['playlist', playlist.id, normalizeForSearch(playlist.name)]));
}

function insertPlaylistTracks(db: Database, playlistTracks: Map<string, NativePlaylistTrack[]>) {
	eachBound(db, 'insert into playlist_track values (?,?,?)', [...playlistTracks].flatMap(([playlistId, tracks]) => tracks.map((track, position) => [playlistId, position, track.mediaFileId])));
}

function rebuildArtists(db: Database) {
	db.exec(`
		delete from artist;
		delete from search where kind = 'artist';
		insert into artist
		select credit.artist_id, min(credit.name), min(credit.name_order), count(*), sum(album.song_count),
			coalesce(min(nullif(album.year, 0)), 0),
			(select newest.id from album_credit newest_credit join album newest on newest.id = newest_credit.album_id
				where newest_credit.artist_id = credit.artist_id order by newest.year desc, newest.created desc limit 1)
		from album_credit credit join album on album.id = credit.album_id group by credit.artist_id;
	`);
	const artists = db.selectArrays('select id, name from artist') as [string, string][];
	eachBound(db, 'insert into search values (?,?,?)', artists.map(([id, name]) => ['artist', id, normalizeForSearch(name)]));
	db.exec(`
		update playlist set kind = 'own', artist_id = '' where kind = 'artist';
		update playlist set artist_id = coalesce((select artist.id from artist where artist.name = substr(playlist.name, ${ARTIST_PLAYLIST_PREFIX.length + 1}) collate nocase limit 1), '')
			where kind = 'own' and readonly = 1 and substr(name, 1, ${ARTIST_PLAYLIST_PREFIX.length}) = '${ARTIST_PLAYLIST_PREFIX}';
		update playlist set kind = 'artist' where artist_id != '';
	`);
}

function rebuildAlbumGenres(db: Database) {
	db.exec(`
		delete from album_genre;
		insert into album_genre select distinct track_genre.genre, track.album_id from track_genre join track on track.id = track_genre.track_id;
		update album set genres = coalesce((select json_group_array(genre) from (select track_genre.genre from track_genre join track on track.id = track_genre.track_id
			where track.album_id = album.id and track_genre.direct = 1 group by track_genre.genre order by count(*) desc, track_genre.genre)), '[]');
	`);
}

function rebuildGenrePlaylists(db: Database) {
	const genreIds = db.selectValues("select id from playlist where kind = 'genre'") as string[];
	deleteWhereIn(db, 'delete from playlist_track where playlist_id = ?', genreIds);
	deleteWhereIn(db, "delete from search where kind = 'playlist' and ref = ?", genreIds);
	db.exec("delete from playlist where kind = 'genre'");
	const rows = db.selectObjects(`select track.id, track.album_id as albumId, album.artist_id as artistId, track.play_count as plays, album.play_count as albumPlays,
		track.starred, track.duration, (select json_group_array(genre) from track_genre where track_genre.track_id = track.id) as genres
		from track join album on album.id = track.album_id where exists (select 1 from track_genre where track_genre.track_id = track.id)`);
	const durations = new Map<string, number>();
	const songs: GenreSong[] = rows.map((row) => {
		durations.set(row.id as string, row.duration as number);
		return { id: row.id as string, albumId: row.albumId as string, artistId: row.artistId as string, genres: JSON.parse(row.genres as string), plays: row.plays as number, albumPlays: row.albumPlays as number, starred: row.starred === 1 };
	});
	const insertPlaylist = db.prepare('insert into playlist values (?,?,?,?,?,?,?,?,?,?,?,?)');
	const insertPlaylistTrack = db.prepare('insert into playlist_track values (?,?,?)');
	const insertSearch = db.prepare('insert into search values (?,?,?)');
	for (const { genre, songs: picked } of chooseGenres(songs)) {
		const id = genrePlaylistId(genre);
		const albumCount = new Set(picked.map((song) => song.albumId)).size;
		const duration = picked.reduce((total, song) => total + (durations.get(song.id) ?? 0), 0);
		insertPlaylist.bind([id, genre, 'genre', '', genre, albumCount, picked.length, duration, '', '', 1, '']).stepReset();
		insertSearch.bind(['playlist', id, normalizeForSearch(genre)]).stepReset();
		picked.forEach((song, position) => insertPlaylistTrack.bind([id, position, song.id]).stepReset());
	}
	insertPlaylist.finalize();
	insertPlaylistTrack.finalize();
	insertSearch.finalize();
}

function rebuildDerived(db: Database) {
	db.exec("update playlist set song_count = (select count(*) from playlist_track where playlist_id = playlist.id) where kind != 'genre'");
	rebuildArtists(db);
	rebuildAlbumGenres(db);
	rebuildGenrePlaylists(db);
	db.exec('delete from search_key; insert into search_key select kind, text, ref from search');
}

function writeMeta(db: Database, meta: Omit<LibraryMeta, 'albums' | 'artists' | 'tracks' | 'playlists'>, sync: SyncState): LibraryMeta {
	const count = (table: string) => Number(db.selectValue(`select count(*) from ${table}`));
	const full: LibraryMeta = { ...meta, albums: count('album'), artists: count('artist'), tracks: count('track'), playlists: count('playlist') };
	db.exec({ sql: 'insert or replace into meta values (?, ?), (?, ?), (?, ?)', bind: ['meta', JSON.stringify(full), 'schema', String(SCHEMA_VERSION), 'sync', JSON.stringify(sync)] });
	return full;
}

export function buildLibrary(db: Database, snapshot: LibrarySnapshot, userId: string, syncedAt: string): LibraryMeta {
	db.exec(SCHEMA);
	db.transaction(() => {
		insertAlbums(db, snapshot.albums);
		insertTracks(db, snapshot.songs, snapshot.albums, createGenreResolver());
		insertPlaylists(db, snapshot.playlists);
		insertPlaylistTracks(db, snapshot.playlistTracks);
		rebuildDerived(db);
	});
	const sync: SyncState = {
		marks: {
			albumImported: newest(snapshot.albums.map((album) => album.importedAt)),
			albumPlayed: newest(snapshot.albums.map((album) => album.playDate)),
			albumStarred: newest(snapshot.albums.map((album) => album.starredAt)),
			songPlayed: newest(snapshot.songs.map((song) => song.playDate)),
			songStarred: newest(snapshot.songs.map((song) => song.starredAt))
		},
		playlists: Object.fromEntries(snapshot.playlists.map((playlist) => [playlist.id, playlistSignature(playlist)])),
		fullSyncAt: syncedAt
	};
	return writeMeta(db, { version: syncedAt, syncedAt, userId }, sync);
}

export function applyChanges(db: Database, meta: LibraryMeta, sync: SyncState, changes: LibraryChanges, syncedAt: string): { meta: LibraryMeta; changed: boolean } {
	const contentChanged = changes.albums.length > 0;
	const playlistsChanged = changes.playlistTracks.size > 0 || changes.playlists.length !== Object.keys(sync.playlists).length || changes.playlists.some((playlist) => !(playlist.id in sync.playlists));
	let statsChanged = 0;
	db.transaction(() => {
		if (contentChanged) {
			const ids = changes.albums.map((album) => album.id);
			removeAlbums(db, ids);
			insertAlbums(db, changes.albums.filter((album) => !album.missing));
			removeTracks(db, changes.albumSongs.map((song) => song.id));
			insertTracks(db, changes.albumSongs, changes.albums, createGenreResolver(db.selectValues('select distinct genre from track_genre') as string[]));
		}
		statsChanged = updateStats(db, 'album', changes.albumStats) + updateStats(db, 'track', changes.songStats);
		if (playlistsChanged) {
			const ids = db.selectValues("select id from playlist where kind != 'genre'") as string[];
			deleteWhereIn(db, "delete from search where kind = 'playlist' and ref = ?", ids);
			db.exec("delete from playlist where kind != 'genre'");
			const current = new Set(changes.playlists.map((playlist) => playlist.id));
			deleteWhereIn(db, 'delete from playlist_track where playlist_id = ?', [...ids.filter((id) => !current.has(id)), ...changes.playlistTracks.keys()]);
			insertPlaylists(db, changes.playlists);
			insertPlaylistTracks(db, changes.playlistTracks);
		}
		if (contentChanged || playlistsChanged) rebuildDerived(db);
	});
	const changed = contentChanged || playlistsChanged || statsChanged > 0;
	const next: SyncState = {
		marks: changes.marks,
		playlists: Object.fromEntries(changes.playlists.map((playlist) => [playlist.id, playlistSignature(playlist)])),
		fullSyncAt: sync.fullSyncAt
	};
	return { meta: writeMeta(db, { version: changed ? syncedAt : meta.version, syncedAt, userId: meta.userId }, next), changed };
}

export function readMeta(db: Database): LibraryMeta | null {
	try {
		const schema = db.selectValue("select value from meta where key = 'schema'");
		if (schema !== String(SCHEMA_VERSION)) return null;
		const value = db.selectValue("select value from meta where key = 'meta'");
		return typeof value === 'string' ? (JSON.parse(value) as LibraryMeta) : null;
	} catch {
		return null;
	}
}

export function readSyncState(db: Database): SyncState | null {
	try {
		const value = db.selectValue("select value from meta where key = 'sync'");
		return typeof value === 'string' ? (JSON.parse(value) as SyncState) : null;
	} catch {
		return null;
	}
}
