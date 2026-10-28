import type { TimelineAlbum } from '../engine/timeline.ts';
import { normalizeForSearch } from './schema.ts';
import { query } from './library.svelte.ts';
import type { SqlParam } from './protocol.ts';

export type Album = {
	id: string;
	name: string;
	artistId: string;
	artist: string;
	year: number;
	genres: string[];
	songCount: number;
	duration: number;
	created: string;
	playCount: number;
	playDate: string;
	starred: boolean;
	credits: { id: string; name: string }[];
};

export type AlbumSummary = Pick<Album, 'id' | 'name' | 'artistId' | 'artist' | 'year' | 'songCount'>;

export type Track = {
	id: string;
	albumId: string;
	album: string;
	title: string;
	artist: string;
	artistId: string;
	albumArtistId: string;
	trackNo: number;
	discNo: number;
	duration: number;
	starred: boolean;
	disliked: boolean;
};

export type Artist = {
	id: string;
	name: string;
	albumCount: number;
	trackCount: number;
	firstYear: number;
	newestAlbumId: string;
	coverAlbumIds: string[];
};

export type PlaylistKind = 'own' | 'smart' | 'genre' | 'artist';

export type Playlist = {
	id: string;
	name: string;
	kind: PlaylistKind;
	ownerId: string;
	genre: string;
	albumCount: number;
	songCount: number;
	duration: number;
	updated: string;
	image: string;
	readonly: boolean;
	artistId: string;
	mosaicAlbumIds: string[];
};

export type AlbumSort = 'mostPlayed' | 'recentlyAdded' | 'byArtist' | 'az' | 'newest';
export type ArtistSort = 'mostAlbums' | 'az';
export type Filters = { genres: string[]; decades: number[] };

type Raw<T> = Omit<T, 'genres' | 'credits' | 'starred' | 'disliked' | 'coverAlbumIds' | 'mosaicAlbumIds' | 'readonly'> & { genres?: string; credits?: string; starred?: number; disliked?: number; coverAlbumIds?: string; mosaicAlbumIds?: string; readonly?: number };

const ALBUM_COLUMNS = `album.id, album.name, album.artist_id as artistId, album.artist, album.year, album.genres, album.song_count as songCount,
	album.duration, album.created, album.play_count as playCount, album.play_date as playDate, album.starred,
	(select json_group_array(json_object('id', artist_id, 'name', name)) from (select artist_id, name from album_credit where album_credit.album_id = album.id order by position)) as credits`;

const TRACK_COLUMNS = `track.id, track.album_id as albumId, album.name as album, track.title, track.artist, track.artist_id as artistId,
	album.artist_id as albumArtistId, track.track_no as trackNo, track.disc_no as discNo, track.duration, track.starred, track.rating = 1 as disliked`;

const ARTIST_COLUMNS = `artist.id, artist.name, artist.album_count as albumCount, artist.track_count as trackCount, artist.first_year as firstYear,
	artist.newest_album_id as newestAlbumId,
	(select json_group_array(id) from (select id from album where exists (select 1 from album_credit where album_credit.album_id = album.id and album_credit.artist_id = artist.id) order by year desc, created desc limit 4)) as coverAlbumIds`;

const PLAYLIST_COLUMNS = `playlist.id, playlist.name, playlist.kind, playlist.owner_id as ownerId, playlist.genre, playlist.album_count as albumCount,
	playlist.song_count as songCount, playlist.duration, playlist.updated, playlist.image, playlist.readonly, playlist.artist_id as artistId,
	(select json_group_array(album_id) from (select track.album_id from playlist_track join track on track.id = playlist_track.track_id
		where playlist_track.playlist_id = playlist.id group by track.album_id order by min(playlist_track.position) limit 8)) as mosaicAlbumIds`;

const toAlbum = (row: Raw<Album>): Album => ({ ...row, genres: JSON.parse(row.genres ?? '[]'), credits: JSON.parse(row.credits ?? '[]'), starred: row.starred === 1 });
const toTrack = (row: Raw<Track>): Track => ({ ...row, starred: row.starred === 1, disliked: row.disliked === 1 });

export const skipsDisliked = (playlist: Pick<Playlist, 'kind'> | null | undefined) => playlist?.kind === 'genre' || playlist?.kind === 'artist';

export function withoutDisliked(tracks: Track[], index = -1) {
	const kept = tracks.filter((track, position) => !track.disliked || position === index);
	return { tracks: kept, index: index < 0 ? 0 : kept.indexOf(tracks[index]) };
}
const toArtist = (row: Raw<Artist>): Artist => ({ ...row, coverAlbumIds: JSON.parse(row.coverAlbumIds ?? '[]') });
const toPlaylist = (row: Raw<Playlist>): Playlist => ({ ...row, readonly: row.readonly === 1, mosaicAlbumIds: JSON.parse(row.mosaicAlbumIds ?? '[]') });

const albums = async (sql: string, params: SqlParam[] = []) => (await query<Raw<Album>>(sql, params)).map(toAlbum);
const tracks = async (sql: string, params: SqlParam[] = []) => (await query<Raw<Track>>(sql, params)).map(toTrack);
const artists = async (sql: string, params: SqlParam[] = []) => (await query<Raw<Artist>>(sql, params)).map(toArtist);
const playlists = async (sql: string, params: SqlParam[] = []) => (await query<Raw<Playlist>>(sql, params)).map(toPlaylist);

const placeholders = (values: unknown[]) => values.map(() => '?').join(',');

function albumFilterSql(filters: Filters): { sql: string; params: SqlParam[] } {
	const parts: string[] = [];
	const params: SqlParam[] = [];
	if (filters.genres.length) {
		parts.push(`exists (select 1 from album_genre where album_genre.album_id = album.id and album_genre.genre in (${placeholders(filters.genres)}))`);
		params.push(...filters.genres);
	}
	if (filters.decades.length) {
		parts.push(`album.year > 0 and (album.year / 10) * 10 in (${placeholders(filters.decades)})`);
		params.push(...filters.decades);
	}
	return { sql: parts.length ? parts.join(' and ') : '1', params };
}

const ALBUM_ORDER: Record<AlbumSort, string> = {
	mostPlayed: 'album.play_count desc, album.name_order',
	recentlyAdded: 'album.created desc, album.name_order',
	byArtist: 'album.artist_order, album.year, album.name_order',
	az: 'album.name_order',
	newest: 'album.year desc, album.name_order'
};

const ARTIST_ORDER: Record<ArtistSort, string> = {
	mostAlbums: 'artist.album_count desc, artist.track_count desc, artist.name_order',
	az: 'artist.name_order'
};

export function albumWall(sort: AlbumSort, filters: Filters): Promise<AlbumSummary[]> {
	const filter = albumFilterSql(filters);
	return query<AlbumSummary>(
		`select album.id, album.name, album.artist_id as artistId, album.artist, album.year, album.song_count as songCount from album where ${filter.sql} order by ${ALBUM_ORDER[sort]}`,
		filter.params
	);
}

export function artistList(sort: ArtistSort, filters: Filters) {
	const filter = albumFilterSql(filters);
	const where = filter.sql === '1' ? '' : `where exists (select 1 from album where exists (select 1 from album_credit where album_credit.album_id = album.id and album_credit.artist_id = artist.id) and ${filter.sql})`;
	return artists(`select ${ARTIST_COLUMNS}, artist.name_order as nameOrder from artist ${where} order by ${ARTIST_ORDER[sort]}`, filter.params);
}

export function artistStrip(filters: Filters, limit: number) {
	const filter = albumFilterSql(filters);
	return artists(
		`select ${ARTIST_COLUMNS.replace('artist.album_count as albumCount', 'count(album.id) as albumCount')}
		from artist join album_credit on album_credit.artist_id = artist.id join album on album.id = album_credit.album_id where ${filter.sql}
		group by artist.id order by count(album.id) desc, artist.track_count desc, artist.name_order limit ?`,
		[...filter.params, limit]
	);
}

export async function genreCounts(): Promise<{ genre: string; albums: number }[]> {
	return query('select genre, count(*) as albums from album_genre group by genre order by genre collate nocase');
}

export async function decadeCounts(): Promise<{ decade: number; albums: number }[]> {
	return query('select (year / 10) * 10 as decade, count(*) as albums from album where year > 0 group by decade order by decade desc');
}

export const albumById = async (id: string) => (await albums(`select ${ALBUM_COLUMNS} from album where id = ?`, [id]))[0] ?? null;

export const albumsByArtist = (artistId: string) => albums(`select ${ALBUM_COLUMNS} from album where exists (select 1 from album_credit where album_credit.album_id = album.id and album_credit.artist_id = ?) order by year desc, created desc`, [artistId]);

export const artistById = async (id: string) => (await artists(`select ${ARTIST_COLUMNS} from artist where id = ?`, [id]))[0] ?? null;

export const albumTracks = (albumId: string) =>
	tracks(`select ${TRACK_COLUMNS} from track join album on album.id = track.album_id where track.album_id = ? order by track.disc_no, track.track_no, track.title`, [albumId]);

export const artistTracks = (artistId: string) =>
	tracks(
		`select ${TRACK_COLUMNS} from track join album on album.id = track.album_id where exists (select 1 from album_credit where album_credit.album_id = album.id and album_credit.artist_id = ?)
		order by album.year desc, album.created desc, album.id, track.disc_no, track.track_no`,
		[artistId]
	);

export const playlistTracks = (playlistId: string) =>
	tracks(
		`select ${TRACK_COLUMNS} from playlist_track join track on track.id = playlist_track.track_id join album on album.id = track.album_id
		where playlist_track.playlist_id = ? order by playlist_track.position`,
		[playlistId]
	);

const ID_CHUNK = 5000;

async function inChunks<T extends { id: string }>(ids: string[], load: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
	const byId = new Map<string, T>();
	for (let start = 0; start < ids.length; start += ID_CHUNK) for (const row of await load(ids.slice(start, start + ID_CHUNK))) byId.set(row.id, row);
	return ids.map((id) => byId.get(id)).filter((row): row is T => !!row);
}

export const RADIO_PREFIX = 'radio:';

export const isRadio = (trackId: string | null | undefined) => !!trackId?.startsWith(RADIO_PREFIX);

export type RadioStation = { id: string; name: string; streamUrl: string; homePageUrl: string };

const radioHost = (url: string) => {
	try {
		return new URL(url).host.replace(/^www\./, '');
	} catch {
		return '';
	}
};

const stationTrack = (station: RadioStation): Track => ({
	id: `${RADIO_PREFIX}${station.id}`,
	albumId: '',
	album: '',
	title: station.name,
	artist: radioHost(station.homePageUrl) || 'Internet radio',
	artistId: '',
	albumArtistId: '',
	trackNo: 0,
	discNo: 0,
	duration: 0,
	starred: false,
	disliked: false
});

export const radioStations = () => query<RadioStation>('select id, name, stream_url as streamUrl, home_page_url as homePageUrl from radio_station order by name collate nocase');

export const radioTracks = async () => (await radioStations()).map(stationTrack);

export async function tracksByIds(ids: string[]) {
	const stations = ids.some(isRadio) ? await radioTracks() : [];
	const found = await inChunks([...new Set(ids.filter((id) => !isRadio(id)))], (chunk) => tracks(`select ${TRACK_COLUMNS} from track join album on album.id = track.album_id where track.id in (${placeholders(chunk)})`, chunk));
	const byId = new Map([...found, ...stations].map((track) => [track.id, track]));
	return ids.map((id) => byId.get(id)).filter((track): track is Track => !!track);
}

export const allPlaylists = () => playlists(`select ${PLAYLIST_COLUMNS} from playlist where kind != 'artist' order by name collate nocase`);

export const artistPlaylist = async (artistId: string) => (await playlists(`select ${PLAYLIST_COLUMNS} from playlist where kind = 'artist' and artist_id = ? limit 1`, [artistId]))[0] ?? null;

export const playlistById = async (id: string) => (await playlists(`select ${PLAYLIST_COLUMNS} from playlist where id = ?`, [id]))[0] ?? null;

export const ownPlaylists = (ownerId: string) => playlists(`select ${PLAYLIST_COLUMNS} from playlist where kind = 'own' and owner_id = ? and readonly = 0 order by name collate nocase`, [ownerId]);

export const albumsByIds = (ids: string[]) => inChunks(ids, (chunk) => albums(`select ${ALBUM_COLUMNS} from album where id in (${placeholders(chunk)})`, chunk));

export const recentlyPlayedAlbums = (limit: number) =>
	albums(`select ${ALBUM_COLUMNS} from album where play_date != '' order by play_date desc limit ?`, [limit]);

const PREFIX_END = '\uffff';

async function matchingRefs(kind: string, needle: string, limit: number): Promise<string[]> {
	const prefixed = await query<{ ref: string }>('select ref from search_key where kind = ? and text >= ? and text < ? limit ?', [kind, needle, needle + PREFIX_END, limit]);
	const refs = prefixed.map((row) => row.ref);
	if (refs.length >= limit) return refs;
	const useIndex = [...needle].length >= 3;
	const remaining = limit - refs.length;
	const substring = useIndex
		? await query<{ ref: string }>('select ref from search where kind = ? and search match ? and instr(text, ?) != 1 limit ?', [kind, `"${needle.replaceAll('"', '""')}"`, needle, remaining])
		: await query<{ ref: string }>(`select ref from search_key where kind = ? and text like ? escape '\\' and instr(text, ?) != 1 limit ?`, [
				kind,
				`%${needle.replace(/[\\%_]/g, (character) => '\\' + character)}%`,
				needle,
				remaining
			]);
	return [...refs, ...substring.map((row) => row.ref)];
}

async function inOrder<T extends { id: string }>(ids: string[], load: (sql: string, params: SqlParam[]) => Promise<T[]>, sql: string): Promise<T[]> {
	if (!ids.length) return [];
	const rows = await load(sql.replace('$ids', placeholders(ids)), ids);
	const byId = new Map(rows.map((row) => [row.id, row]));
	return ids.map((id) => byId.get(id)).filter((row): row is T => !!row);
}

export type SearchResults = { artists: Artist[]; albums: Album[]; playlists: Playlist[]; tracks: Track[] };

export async function search(text: string, limits: { artists: number; albums: number; playlists: number; tracks: number }): Promise<SearchResults> {
	const needle = normalizeForSearch(text.trim());
	if (!needle) return { artists: [], albums: [], playlists: [], tracks: [] };
	const [artistIds, albumIds, playlistIds, trackIds] = await Promise.all([
		matchingRefs('artist', needle, limits.artists),
		matchingRefs('album', needle, limits.albums),
		matchingRefs('playlist', needle, limits.playlists),
		matchingRefs('track', needle, limits.tracks)
	]);
	const [foundArtists, foundAlbums, foundPlaylists, foundTracks] = await Promise.all([
		inOrder(artistIds, artists, `select ${ARTIST_COLUMNS} from artist where id in ($ids)`),
		albumsByIds(albumIds),
		inOrder(playlistIds, playlists, `select ${PLAYLIST_COLUMNS} from playlist where id in ($ids)`),
		tracksByIds(trackIds)
	]);
	return { artists: foundArtists, albums: foundAlbums, playlists: foundPlaylists, tracks: foundTracks };
}

export const timelineAlbums = () => query<TimelineAlbum>('select id, name, artist_id as artistId, artist, year from album order by year, name');

export async function paletteLeads(): Promise<Map<string, string>> {
	const rows = await query<{ albumId: string; colors: string }>('select album_id as albumId, colors from palette');
	return new Map(rows.flatMap((row) => {
		const lead = (JSON.parse(row.colors) as string[])[0];
		return lead ? [[row.albumId, lead] as const] : [];
	}));
}

export async function savedPalette(albumId: string): Promise<string[] | null> {
	const rows = await query<{ colors: string }>('select colors from palette where album_id = ?', [albumId]);
	return rows[0] ? (JSON.parse(rows[0].colors) as string[]) : null;
}
