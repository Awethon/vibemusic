import type { Database } from '@sqlite.org/sqlite-wasm';
import type { NativeAlbum, NativePlaylist, NativePlaylistTrack, NativeSong, RadioStation } from '../navidrome/schemas.ts';
import { deezerAlbumGenre } from '../genres/deezer.ts';
import { genresFromEvidence, type Tag } from '../genres/evidence.ts';
import { createGenreResolver, regionalGenres, withAncestors } from '../genres/genres.ts';
import { songRanks } from '../genres/titles.ts';
import { GENRE_EVIDENCE, GENRE_PLAYLISTS, HIDDEN_GENRE_PLAYLISTS } from '../tuning.ts';
import { chooseGenres, type GenreSong } from '../genres/playlists.ts';
import { KEPT_TABLES, normalizeForSearch, SCHEMA, SCHEMA_VERSION } from './schema.ts';
import type { Enrichment, EnrichmentRequest, LibraryChanges, LibraryMeta, LibrarySnapshot, SyncState } from './snapshot.ts';

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

function eachBound(db: Database, sql: string, rows: (string | number | null)[][]) {
	if (!rows.length) return;
	const statement = db.prepare(sql);
	for (const row of rows) statement.bind(row).stepReset();
	statement.finalize();
}

function deleteWhereIn(db: Database, sql: string, ids: string[]) {
	eachBound(db, sql, ids.map((id) => [id]));
}

function insertAlbums(db: Database, albums: NativeAlbum[]) {
	eachBound(db, 'insert into album values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', albums.map((album) => [album.id, album.name, album.orderAlbumName || album.name.toLowerCase(), album.albumArtistId, album.albumArtist, album.orderAlbumArtistName || album.albumArtist.toLowerCase(), album.maxYear, JSON.stringify(albumGenresOf(album)), album.songCount, album.duration, album.createdAt, album.updatedAt, album.playCount, album.playDate, album.starred ? 1 : 0, JSON.stringify(albumGenresOf(album)), album.mbzReleaseGroupId, album.imageHash]));
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

function insertTracks(db: Database, songs: NativeSong[]) {
	eachBound(db, 'insert or ignore into track values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', songs.map((song) => [song.id, song.albumId, song.title, song.artist, song.artistId, song.trackNumber, song.discNumber, song.duration, song.suffix, song.bitRate, song.playCount, song.playDate, song.starred ? 1 : 0, JSON.stringify(songGenresOf(song)), song.rating]));
	eachBound(db, 'insert into search values (?,?,?)', songs.map((song) => ['track', song.id, normalizeForSearch(`${song.title} ${song.artist}`)]));
}

function replaceRadioStations(db: Database, stations: RadioStation[] | null): boolean {
	if (!stations) return false;
	const before = JSON.stringify(db.selectArrays('select id, name, stream_url, home_page_url from radio_station order by id'));
	db.exec('delete from radio_station');
	eachBound(db, 'insert or replace into radio_station values (?,?,?,?)', stations.map((station) => [station.id, station.name, station.streamUrl, station.homePageUrl]));
	return JSON.stringify(db.selectArrays('select id, name, stream_url, home_page_url from radio_station order by id')) !== before;
}

function removeTracks(db: Database, ids: string[]) {
	deleteWhereIn(db, 'delete from track where id = ?', ids);
	deleteWhereIn(db, 'delete from track_genre where track_id = ?', ids);
	deleteWhereIn(db, "delete from search where kind = 'track' and ref = ?", ids);
}

function updateRatings(db: Database, ratings: Map<string, number>): number {
	const current = new Map(db.selectObjects('select id, rating from track where rating != 0').map((row) => [row.id as string, row.rating as number]));
	const changed: [number, string][] = [...current.keys()].filter((id) => !ratings.has(id)).map((id) => [0, id]);
	for (const [id, rating] of ratings) if (current.get(id) !== rating && db.selectValue('select 1 from track where id = ?', [id])) changed.push([rating, id]);
	eachBound(db, 'update track set rating = ? where id = ?', changed);
	return changed.length;
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

function updateImageHashes(db: Database, hashes: Map<string, string>): number {
	const update = db.prepare('update album set image_hash = ? where id = ? and image_hash != ?');
	let changed = 0;
	for (const [id, hash] of hashes) {
		update.bind([hash, id, hash]).stepReset();
		changed += db.changes();
	}
	update.finalize();
	return changed;
}

function insertPlaylists(db: Database, playlists: NativePlaylist[], userId: string) {
	eachBound(db, 'insert into playlist values (?,?,?,?,?,?,?,?,?,?,?,?)', playlists.map((playlist) => [playlist.id, playlist.name, playlist.rules ? 'smart' : 'own', playlist.ownerId, '', 0, 0, playlist.duration, playlist.evaluatedAt || playlist.updatedAt, playlist.uploadedImage, playlist.sync || playlist.ownerId !== userId ? 1 : 0, '']));
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

const parsedTags = (value: unknown): Tag[] | null => (typeof value === 'string' ? (JSON.parse(value) as Tag[]) : null);

type MbArtistRow = { tags: Tag[] | null; countries: string[] };

function musicBrainzArtists(db: Database) {
	const artists = new Map(
		db.selectObjects('select id, tags, countries from mb_artist').map((row) => [row.id as string, { tags: parsedTags(row.tags), countries: typeof row.countries === 'string' ? (JSON.parse(row.countries) as string[]) : [] } satisfies MbArtistRow])
	);
	const byAlbumArtist = new Map<string, string>(db.selectArrays('select artist_id, mbid from artist_match where mbid is not null') as [string, string][]);
	const counted = db.selectArrays(`select album.artist_id, json_extract(mb_release_group.artists, '$[0]') as mbid, count(*) as albums from album
		join mb_release_group on mb_release_group.id = album.release_group where mb_release_group.artists is not null group by album.artist_id, mbid order by albums desc`) as [string, string, number][];
	for (const [artistId, mbid] of counted) if (!byAlbumArtist.has(artistId) && mbid) byAlbumArtist.set(artistId, mbid);
	return { artists, byAlbumArtist };
}

function rebuildTrackGenres(db: Database) {
	db.exec('delete from track_genre');
	const resolver = createGenreResolver();
	const albumTags = new Map<string, Tag[] | null>();
	const storeGenres = new Map<string, string | null>();
	const { artists, byAlbumArtist } = musicBrainzArtists(db);
	const rows = db.selectObjects(`select track.id, track.raw_genres as songGenres, album.id as albumId, album.name as albumName, album.raw_genres as albumGenres, album.artist_id as albumArtistId,
		mb_release_group.tags as albumTags, json_extract(mb_release_group.artists, '$[0]') as groupArtist, deezer_artist.albums as deezerAlbums
		from track join album on album.id = track.album_id
		left join mb_release_group on mb_release_group.id = album.release_group
		left join deezer_artist on deezer_artist.artist_id = album.artist_id`);
	const insert = db.prepare('insert or ignore into track_genre values (?,?,?)');
	for (const row of rows) {
		const songGenres = JSON.parse(row.songGenres as string) as string[];
		const albumId = row.albumId as string;
		if (!albumTags.has(albumId)) albumTags.set(albumId, parsedTags(row.albumTags));
		if (!storeGenres.has(albumId)) storeGenres.set(albumId, deezerAlbumGenre(typeof row.deezerAlbums === 'string' ? JSON.parse(row.deezerAlbums) : null, row.albumName as string));
		const artist = artists.get(byAlbumArtist.get(row.albumArtistId as string) ?? '') ?? artists.get((row.groupArtist as string | null) ?? '');
		const direct = genresFromEvidence(resolver, {
			fileGenres: songGenres.length ? songGenres : (JSON.parse(row.albumGenres as string) as string[]),
			albumTags: albumTags.get(albumId) ?? null,
			artistTags: artist?.tags ?? null,
			storeGenre: storeGenres.get(albumId)
		});
		const regional = regionalGenres(direct.flatMap(withAncestors), artist?.countries ?? []);
		const all = [...new Set([...direct, ...regional])];
		for (const genre of all) insert.bind([genre, row.id as string, 1]).stepReset();
		for (const genre of new Set(all.flatMap(withAncestors))) if (!all.includes(genre)) insert.bind([genre, row.id as string, 0]).stepReset();
	}
	insert.finalize();
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
	const rows = db.selectObjects(`select track.id, track.title, track.album_id as albumId, album.artist_id as artistId, album.year, track.play_count as plays,
		track.starred, track.duration, (select json_group_array(genre) from track_genre where track_genre.track_id = track.id) as genres
		from track join album on album.id = track.album_id where exists (select 1 from track_genre where track_genre.track_id = track.id)`);
	const deezer = new Map(
		db.selectObjects('select artist_id, fans, top from deezer_artist where deezer_id is not null').map((row) => [row.artist_id as string, { fans: row.fans as number, rankOf: songRanks(JSON.parse(row.top as string)) }])
	);
	const apple = new Map(
		db.selectObjects('select artist_id, top from apple_artist where top is not null').map((row) => {
			const titles = JSON.parse(row.top as string) as string[];
			return [row.artist_id as string, songRanks(titles.map((title, index) => [title, titles.length - index]))];
		})
	);
	const durations = new Map<string, number>();
	const songs: GenreSong[] = rows.map((row) => {
		durations.set(row.id as string, row.duration as number);
		const artist = deezer.get(row.artistId as string);
		return {
			id: row.id as string,
			title: row.title as string,
			duration: row.duration as number,
			year: row.year as number,
			albumId: row.albumId as string,
			artistId: row.artistId as string,
			genres: JSON.parse(row.genres as string),
			plays: row.plays as number,
			starred: row.starred === 1,
			fans: artist?.fans ?? null,
			popularity: artist?.rankOf(row.title as string) ?? null,
			rank: apple.get(row.artistId as string)?.(row.title as string) ?? null
		};
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
	rebuildTrackGenres(db);
	rebuildAlbumGenres(db);
	rebuildGenrePlaylists(db);
	db.exec('delete from search_key; insert into search_key select kind, text, ref from search');
}

const DERIVED_RULES = JSON.stringify({ algorithm: 10, evidence: GENRE_EVIDENCE, playlists: GENRE_PLAYLISTS, hidden: HIDDEN_GENRE_PLAYLISTS });

function writeMeta(db: Database, meta: Omit<LibraryMeta, 'albums' | 'artists' | 'tracks' | 'playlists'>, sync: SyncState): LibraryMeta {
	const count = (table: string) => Number(db.selectValue(`select count(*) from ${table}`));
	const full: LibraryMeta = { ...meta, albums: count('album'), artists: count('artist'), tracks: count('track'), playlists: count('playlist') };
	db.exec({ sql: 'insert or replace into meta values (?, ?), (?, ?), (?, ?), (?, ?)', bind: ['meta', JSON.stringify(full), 'schema', String(SCHEMA_VERSION), 'sync', JSON.stringify(sync), 'derived', DERIVED_RULES] });
	return full;
}

function carryKept(from: Database | null, to: Database) {
	if (!from) return;
	for (const table of KEPT_TABLES) {
		const previous = new Set(from.selectValues(`select name from pragma_table_info('${table}')`) as string[]);
		const columns = (to.selectValues(`select name from pragma_table_info('${table}')`) as string[]).filter((column) => previous.has(column));
		if (!columns.length) continue;
		const rows = from.selectArrays(`select ${columns.join(',')} from ${table}`);
		if (!rows.length) continue;
		const insert = to.prepare(`insert or replace into ${table} (${columns.join(',')}) values (${columns.map(() => '?').join(',')})`);
		for (const row of rows) insert.bind(row as (string | number | null)[]).stepReset();
		insert.finalize();
	}
}

export function buildLibrary(db: Database, snapshot: LibrarySnapshot, userId: string, syncedAt: string, previous: Database | null = null): LibraryMeta {
	db.exec(SCHEMA);
	carryKept(previous, db);
	db.transaction(() => {
		insertAlbums(db, snapshot.albums);
		insertTracks(db, snapshot.songs);
		insertPlaylists(db, snapshot.playlists, userId);
		insertPlaylistTracks(db, snapshot.playlistTracks);
		replaceRadioStations(db, snapshot.radioStations);
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
		fullSyncAt: syncedAt,
		lastScan: ''
	};
	return writeMeta(db, { version: syncedAt, syncedAt, userId }, sync);
}

export function applyChanges(db: Database, meta: LibraryMeta, sync: SyncState, changes: LibraryChanges, syncedAt: string): { meta: LibraryMeta; changed: boolean } {
	const contentChanged = changes.albums.length > 0;
	const playlistsChanged = changes.playlistTracks.size > 0 || changes.playlists.length !== Object.keys(sync.playlists).length || changes.playlists.some((playlist) => !(playlist.id in sync.playlists));
	let statsChanged = 0;
	let radioChanged = false;
	let hashesChanged = 0;
	db.transaction(() => {
		if (contentChanged) {
			const ids = changes.albums.map((album) => album.id);
			removeAlbums(db, ids);
			insertAlbums(db, changes.albums.filter((album) => !album.missing));
			removeTracks(db, changes.albumSongs.map((song) => song.id));
			insertTracks(db, changes.albumSongs);
		}
		statsChanged = updateStats(db, 'album', changes.albumStats) + updateStats(db, 'track', changes.songStats) + updateRatings(db, changes.ratings);
		if (playlistsChanged) {
			const ids = db.selectValues("select id from playlist where kind != 'genre'") as string[];
			deleteWhereIn(db, "delete from search where kind = 'playlist' and ref = ?", ids);
			db.exec("delete from playlist where kind != 'genre'");
			const current = new Set(changes.playlists.map((playlist) => playlist.id));
			deleteWhereIn(db, 'delete from playlist_track where playlist_id = ?', [...ids.filter((id) => !current.has(id)), ...changes.playlistTracks.keys()]);
			insertPlaylists(db, changes.playlists, meta.userId);
			insertPlaylistTracks(db, changes.playlistTracks);
		}
		radioChanged = replaceRadioStations(db, changes.radioStations);
		if (changes.imageHashes) hashesChanged = updateImageHashes(db, changes.imageHashes);
		if (contentChanged || playlistsChanged) rebuildDerived(db);
	});
	const changed = contentChanged || playlistsChanged || radioChanged || statsChanged > 0 || hashesChanged > 0;
	const next: SyncState = {
		marks: changes.marks,
		playlists: Object.fromEntries(changes.playlists.map((playlist) => [playlist.id, playlistSignature(playlist)])),
		fullSyncAt: sync.fullSyncAt,
		lastScan: changes.lastScan
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

const VARIOUS_ARTISTS = new Set(['various artists', 'various', 'va']);
const SONGS_PER_ARTIST = 5;

export function enrichmentRequest(db: Database): EnrichmentRequest {
	const since = Number(db.selectValue("select value from enrichment_state where key = 'since'") ?? 0);
	const releaseGroups = db.selectValues("select distinct release_group from album where release_group != ''") as string[];
	const titles = new Map<string, { name: string; songs: string[] }>();
	const rows = db.selectObjects(`select album.artist_id as id, album.artist as name, track.title from track join album on album.id = track.album_id
		where album.artist_id != '' order by album.artist_id, track.play_count desc, album.play_count desc, track.disc_no, track.track_no`);
	for (const row of rows) {
		if (VARIOUS_ARTISTS.has((row.name as string).toLowerCase())) continue;
		const artist = titles.get(row.id as string) ?? { name: row.name as string, songs: [] };
		if (artist.songs.length < SONGS_PER_ARTIST && !artist.songs.includes(row.title as string)) artist.songs.push(row.title as string);
		titles.set(row.id as string, artist);
	}
	const albumsByArtist = new Map<string, { name: string; albums: string[]; tagged: boolean }>();
	for (const row of db.selectObjects("select artist_id as id, artist as name, name as album, release_group from album where artist_id != ''")) {
		if (VARIOUS_ARTISTS.has((row.name as string).toLowerCase())) continue;
		const artist = albumsByArtist.get(row.id as string) ?? { name: row.name as string, albums: [], tagged: false };
		artist.albums.push(row.album as string);
		artist.tagged ||= row.release_group !== '';
		albumsByArtist.set(row.id as string, artist);
	}
	const mbSearch = [...albumsByArtist].filter(([, artist]) => !artist.tagged).map(([id, { name, albums }]) => ({ id, name, albums }));
	return { since, releaseGroups, artists: [...titles].map(([id, artist]) => ({ id, ...artist, albums: albumsByArtist.get(id)?.albums ?? [] })), mbSearch };
}

export function applyEnrichment(db: Database, meta: LibraryMeta, sync: SyncState, enrichment: Enrichment): LibraryMeta {
	db.transaction(() => {
		eachBound(db, 'insert or replace into mb_release_group values (?,?,?)', Object.entries(enrichment.releaseGroups).map(([id, group]) => [id, group && JSON.stringify(group.artists), group && JSON.stringify(group.tags)]));
		eachBound(db, 'insert or replace into mb_artist values (?,?,?)', Object.entries(enrichment.mbArtists).map(([id, artist]) => [id, artist && JSON.stringify(artist.tags), artist?.countries ? JSON.stringify(artist.countries) : null]));
		eachBound(db, 'insert or replace into artist_match values (?,?)', Object.entries(enrichment.artistMatches ?? {}).map(([id, mbid]) => [id, mbid]));
		eachBound(db, 'insert or replace into apple_artist values (?,?)', Object.entries(enrichment.apple ?? {}).map(([id, top]) => [id, top && JSON.stringify(top)]));
		eachBound(db, 'insert or replace into deezer_artist values (?,?,?,?,?,?)', Object.entries(enrichment.deezer).map(([id, artist]) => [id, artist && artist.id, artist && artist.name, artist && artist.fans, artist && JSON.stringify(artist.top), artist?.albums ? JSON.stringify(artist.albums) : null]));
		db.exec({ sql: "insert or replace into enrichment_state values ('since', max(?, coalesce((select cast(value as integer) from enrichment_state where key = 'since'), 0)))", bind: [enrichment.at] });
		rebuildDerived(db);
	});
	return writeMeta(db, { version: new Date().toISOString(), syncedAt: meta.syncedAt, userId: meta.userId }, sync);
}

export function refreshDerived(db: Database, meta: LibraryMeta): LibraryMeta | null {
	const sync = readSyncState(db);
	if (!sync || db.selectValue("select value from meta where key = 'derived'") === DERIVED_RULES) return null;
	db.transaction(() => rebuildDerived(db));
	return writeMeta(db, { version: new Date().toISOString(), syncedAt: meta.syncedAt, userId: meta.userId }, sync);
}
