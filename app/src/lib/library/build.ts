import type { Database } from '@sqlite.org/sqlite-wasm';
import { LIBRARY_RULES } from '../tuning.ts';
import { normalizeForSearch, SCHEMA, SCHEMA_VERSION } from './schema.ts';
import type { LibraryMeta, LibrarySnapshot } from './snapshot.ts';

const albumGenresOf = (album: LibrarySnapshot['albums'][number]) => {
	const names = album.genres.map((genre) => genre.name).filter(Boolean);
	return names.length ? [...new Set(names)] : album.genre ? [album.genre] : [];
};

export const genrePlaylistId = (genre: string) => 'genre-' + genre.toLowerCase().replace(/[^a-z0-9а-яё]+/g, '-');

export function buildLibrary(db: Database, snapshot: LibrarySnapshot, userId: string, syncedAt: string): LibraryMeta {
	db.exec(SCHEMA);
	const genresByAlbum = new Map(snapshot.albums.map((album) => [album.id, albumGenresOf(album)]));
	db.transaction(() => {
		const insertAlbum = db.prepare('insert into album values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
		const insertAlbumGenre = db.prepare('insert or ignore into album_genre values (?,?)');
		const insertSearch = db.prepare('insert into search values (?,?,?)');
		for (const album of snapshot.albums) {
			const genres = genresByAlbum.get(album.id) ?? [];
			insertAlbum
				.bind([album.id, album.name, album.orderAlbumName || album.name.toLowerCase(), album.albumArtistId, album.albumArtist, album.orderAlbumArtistName || album.albumArtist.toLowerCase(), album.maxYear, JSON.stringify(genres), album.songCount, album.duration, album.createdAt, album.updatedAt, album.playCount, album.playDate, album.starred ? 1 : 0])
				.stepReset();
			for (const genre of genres) insertAlbumGenre.bind([genre, album.id]).stepReset();
			insertSearch.bind(['album', album.id, normalizeForSearch(`${album.name} ${album.albumArtist}`)]).stepReset();
		}
		insertAlbum.finalize();
		insertAlbumGenre.finalize();

		db.exec(`
			insert into artist
			select artist_id, artist, min(artist_order), count(*), sum(song_count),
				coalesce(min(nullif(year, 0)), 0),
				(select id from album newest where newest.artist_id = album.artist_id order by year desc, created desc limit 1)
			from album where artist_id != '' group by artist_id
		`);
		for (const artist of db.selectObjects('select id, name from artist')) {
			insertSearch.bind(['artist', artist.id as string, normalizeForSearch(artist.name as string)]).stepReset();
		}

		const insertTrack = db.prepare('insert or ignore into track values (?,?,?,?,?,?,?,?,?,?,?,?,?)');
		for (const song of snapshot.songs) {
			insertTrack
				.bind([song.id, song.albumId, song.title, song.artist, song.artistId, song.trackNumber, song.discNumber, song.duration, song.suffix, song.bitRate, song.playCount, song.playDate, song.starred ? 1 : 0])
				.stepReset();
			insertSearch.bind(['track', song.id, normalizeForSearch(`${song.title} ${song.artist}`)]).stepReset();
		}
		insertTrack.finalize();

		const insertPlaylist = db.prepare('insert into playlist values (?,?,?,?,?,?,?,?,?)');
		const insertPlaylistTrack = db.prepare('insert into playlist_track values (?,?,?)');
		for (const playlist of snapshot.playlists) {
			const tracks = snapshot.playlistTracks.get(playlist.id) ?? [];
			insertPlaylist
				.bind([playlist.id, playlist.name, playlist.rules ? 'smart' : 'own', playlist.ownerId, '', 0, tracks.length, playlist.duration, playlist.evaluatedAt || playlist.updatedAt])
				.stepReset();
			tracks.forEach((track, position) => insertPlaylistTrack.bind([playlist.id, position, track.mediaFileId]).stepReset());
			insertSearch.bind(['playlist', playlist.id, normalizeForSearch(playlist.name)]).stepReset();
		}

		const genres = db.selectObjects(
			`select genre, count(*) as albums from album_genre group by genre having count(*) >= ? order by albums desc, genre limit ?`,
			[LIBRARY_RULES.genrePlaylistMinAlbums, LIBRARY_RULES.genrePlaylistMaxCount]
		);
		for (const row of genres) {
			const genre = row.genre as string;
			const albumIds = db.selectValues(
				`select album.id from album_genre join album on album.id = album_genre.album_id where genre = ? order by album.play_count desc, album.name_order`,
				[genre]
			) as string[];
			const trackIds: string[] = [];
			let duration = 0;
			let albumCount = 0;
			for (const albumId of albumIds) {
				if (trackIds.length >= LIBRARY_RULES.genrePlaylistTrackCap) break;
				const tracks = db.selectObjects('select id, duration from track where album_id = ? order by disc_no, track_no', [albumId]);
				albumCount += 1;
				for (const track of tracks) {
					trackIds.push(track.id as string);
					duration += track.duration as number;
				}
			}
			const id = genrePlaylistId(genre);
			insertPlaylist.bind([id, genre, 'genre', '', genre, albumCount, trackIds.length, duration, '']).stepReset();
			insertSearch.bind(['playlist', id, normalizeForSearch(genre)]).stepReset();
			trackIds.forEach((trackId, position) => insertPlaylistTrack.bind([id, position, trackId]).stepReset());
		}
		insertPlaylist.finalize();
		insertPlaylistTrack.finalize();
		insertSearch.finalize();
		db.exec('insert into search_key select kind, text, ref from search');
	});

	const count = (table: string) => Number(db.selectValue(`select count(*) from ${table}`));
	const meta: LibraryMeta = {
		version: snapshot.version,
		syncedAt,
		userId,
		albums: count('album'),
		artists: count('artist'),
		tracks: count('track'),
		playlists: count('playlist')
	};
	db.exec({ sql: 'insert into meta values (?, ?), (?, ?)', bind: ['meta', JSON.stringify(meta), 'schema', String(SCHEMA_VERSION)] });
	return meta;
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
