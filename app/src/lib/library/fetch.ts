// Reading the library from Navidrome's native API: everything for a full build (fetchLibrary), or
// just what changed since the last sync's marks (fetchChanges).

import type { z } from 'zod';
import type { NavidromeHttp } from '../navidrome/http.ts';
import {
	nativeAlbum,
	nativeArtist,
	nativePlaylist,
	nativePlaylistTrack,
	nativeSong,
	radioStation,
	type NativePlaylist,
	type NativePlaylistTrack,
	type RadioStation
} from '../navidrome/schemas.ts';
import { LIBRARY_SYNC } from '../tuning.ts';
import { newest, playlistSignature } from './build.ts';
import type { SyncProgress } from './protocol.ts';
import type { LibraryChanges, LibrarySnapshot, SyncState } from './snapshot.ts';

export async function fetchPlaylists(http: NavidromeHttp): Promise<NativePlaylist[]> {
	return nativePlaylist.array().parse(await http.nativeAll('playlist?_sort=name&_order=ASC', LIBRARY_SYNC.pageSize));
}

type RadioResponse = { internetRadioStations?: { internetRadioStation?: unknown[] } };

// null on failure, so a failed request never wipes the stored stations.
async function fetchRadioStations(http: NavidromeHttp): Promise<RadioStation[] | null> {
	try {
		return radioStation
			.array()
			.parse((await http.subsonic<RadioResponse>('getInternetRadioStations')).internetRadioStations?.internetRadioStation ?? []);
	} catch {
		return null;
	}
}

async function fetchPlaylistTracks(http: NavidromeHttp, playlist: NativePlaylist): Promise<NativePlaylistTrack[]> {
	return (
		nativePlaylistTrack
			.array()
			// A playlist track's id is its position, so this is playlist order.
			.parse(await http.nativeAll(`playlist/${playlist.id}/tracks?_sort=id&_order=ASC`, LIBRARY_SYNC.pageSize))
	);
}

// Everything for a full build. missing=false: Navidrome keeps rows for files that disappeared from
// disk, flagged as missing.
export async function fetchLibrary(http: NavidromeHttp, onProgress: (progress: SyncProgress) => void = () => {}): Promise<LibrarySnapshot> {
	const progress: SyncProgress = { albums: 0, albumTotal: 0, tracks: 0, trackTotal: 0, playlists: 0, playlistTotal: 0, building: false };
	const report = (update: Partial<SyncProgress>) => {
		Object.assign(progress, update);
		onProgress({ ...progress });
	};
	const steps: Record<string, number> = {};
	const timed = async <T>(step: string, work: () => Promise<T>): Promise<T> => {
		const started = performance.now();
		try {
			return await work();
		} finally {
			steps[step] = Math.round(performance.now() - started);
		}
	};
	const [playlists, radioStations] = await Promise.all([timed('playlists', () => fetchPlaylists(http)), fetchRadioStations(http)]);
	report({ playlistTotal: playlists.length });
	const [albums, songs, artists] = await Promise.all([
		timed('albums', async () =>
			nativeAlbum
				.array()
				.parse(
					await http.nativeAll('album?missing=false&_sort=name&_order=ASC', LIBRARY_SYNC.pageSize, (loaded, albumTotal) =>
						report({ albums: loaded, albumTotal })
					)
				)
		),
		timed('songs', async () =>
			nativeSong
				.array()
				.parse(
					await http.nativeAll('song?missing=false&_sort=album&_order=ASC', LIBRARY_SYNC.pageSize, (loaded, trackTotal) =>
						report({ tracks: loaded, trackTotal })
					)
				)
		),
		timed('artists', () => fetchArtistArt(http))
	]);
	const playlistTracks = await timed(
		'playlist tracks',
		async () =>
			new Map(
				await Promise.all(
					playlists.map(
						async (playlist) =>
							[
								playlist.id,
								await timed(`playlist ${playlist.name}`, async () => {
									const tracks = await fetchPlaylistTracks(http, playlist);
									report({ playlists: progress.playlists + 1 });
									return tracks;
								})
							] as const
					)
				)
			)
	);
	report({ building: true });
	return { albums, songs, playlists, playlistTracks, radioStations: radioStations ?? [], artists, steps };
}

// Reads a list sorted newest-first by `stampOf` until it reaches items no newer than `mark`.
// Usually only a handful changed, so pages start tiny and grow 4x each time.
async function changedSince<T>(
	http: NavidromeHttp,
	path: string,
	schema: z.ZodType<T>,
	stampOf: (item: T) => string,
	mark: string
): Promise<T[]> {
	const since = mark ? Date.parse(mark) : -Infinity;
	const found: T[] = [];
	for (let start = 0, size = LIBRARY_SYNC.changePageSize; ; start += size, size *= 4) {
		const page = await http.nativePage(path, start, start + size);
		for (const item of schema.array().parse(page.items)) {
			const stamp = stampOf(item);
			if (!stamp || Date.parse(stamp) <= since) return found;
			found.push(item);
		}
		if (!page.items.length || start + size >= page.total) return found;
	}
}

// Smart playlist rule fields that depend on listening activity. A smart playlist using any of them
// can change after a play or star, so its tracks are refetched when listening data changed.
const LISTENING_FIELDS = new Set([
	'loved',
	'dateloved',
	'lastplayed',
	'daterated',
	'playcount',
	'rating',
	'averagerating',
	'albumrating',
	'albumloved',
	'albumplaycount',
	'albumlastplayed',
	'albumdateloved',
	'albumdaterated',
	'artistrating',
	'artistloved',
	'artistplaycount',
	'artistlastplayed',
	'artistdateloved',
	'artistdaterated'
]);

// Matches any listed word anywhere in the rules JSON; a false positive only costs one extra
// playlist fetch.
export const followsListening = (rules: unknown) =>
	(
		JSON.stringify(rules)
			.toLowerCase()
			.match(/[a-z_]+/g) ?? []
	).some((word) => LISTENING_FIELDS.has(word));

async function fetchTotal(http: NavidromeHttp, path: string): Promise<number> {
	return (await http.nativePage(path, 0, 1)).total;
}

async function fetchAlbumSongs(http: NavidromeHttp, albumIds: string[]) {
	const batches: string[][] = [];
	for (let index = 0; index < albumIds.length; index += LIBRARY_SYNC.albumsPerSongRequest)
		batches.push(albumIds.slice(index, index + LIBRARY_SYNC.albumsPerSongRequest));
	const pages = await Promise.all(
		batches.map(async (ids) =>
			nativeSong
				.array()
				.parse(
					await http.nativeAll(
						`song?missing=false&${ids.map((id) => `album_id=${encodeURIComponent(id)}`).join('&')}&_sort=album&_order=ASC`,
						LIBRARY_SYNC.pageSize
					)
				)
		)
	);
	return pages.flat();
}

async function fetchArtistArt(http: NavidromeHttp, artistIds?: string[]) {
	if (!artistIds)
		return nativeArtist.array().parse(await http.nativeAll('artist?role=albumartist&_sort=name&_order=ASC', LIBRARY_SYNC.pageSize));
	const batches: string[][] = [];
	for (let index = 0; index < artistIds.length; index += LIBRARY_SYNC.albumsPerSongRequest)
		batches.push(artistIds.slice(index, index + LIBRARY_SYNC.albumsPerSongRequest));
	const pages = await Promise.all(
		batches.map(async (ids) =>
			nativeArtist
				.array()
				.parse(await http.nativeAll(`artist?${ids.map((id) => `id=${encodeURIComponent(id)}`).join('&')}`, LIBRARY_SYNC.pageSize))
		)
	);
	return pages.flat();
}

async function fetchAlbumsById(http: NavidromeHttp, albumIds: string[]) {
	const batches: string[][] = [];
	for (let index = 0; index < albumIds.length; index += LIBRARY_SYNC.albumsPerSongRequest)
		batches.push(albumIds.slice(index, index + LIBRARY_SYNC.albumsPerSongRequest));
	const pages = await Promise.all(
		batches.map(async (ids) =>
			nativeAlbum
				.array()
				.parse(await http.nativeAll(`album?${ids.map((id) => `id=${encodeURIComponent(id)}`).join('&')}`, LIBRARY_SYNC.pageSize))
		)
	);
	return pages.flat();
}

/**
 * Everything that changed since the marks in `sync`, or null when a full sync is the better
 * choice (too many albums changed).
 */
export async function fetchChanges(
	http: NavidromeHttp,
	sync: SyncState,
	localAlbums: number,
	refreshedAlbumIds: string[],
	refreshedArtistIds: string[]
): Promise<LibraryChanges | null> {
	const { marks } = sync;
	const [imported, refreshed, albumPlays, albumStars, songPlays, songStars, rated, playlists, radioStations] = await Promise.all([
		// No missing=false here: albums that went missing must come through so applyChanges can drop them.
		changedSince(http, 'album?_sort=importedAt&_order=DESC', nativeAlbum, (album) => album.importedAt, marks.albumImported),
		fetchAlbumsById(http, refreshedAlbumIds),
		changedSince(http, 'album?_sort=playDate&_order=DESC', nativeAlbum, (album) => album.playDate, marks.albumPlayed),
		changedSince(http, 'album?_sort=starredAt&_order=DESC', nativeAlbum, (album) => album.starredAt, marks.albumStarred),
		changedSince(http, 'song?_sort=playDate&_order=DESC', nativeSong, (song) => song.playDate, marks.songPlayed),
		changedSince(http, 'song?_sort=starredAt&_order=DESC', nativeSong, (song) => song.starredAt, marks.songStarred),
		// All rated songs, not just changed ones: a cleared rating only shows up as a song missing
		// from this list (see updateRatings).
		http.nativeAll('song?has_rating=true&_sort=title&_order=ASC', LIBRARY_SYNC.pageSize).then((songs) => nativeSong.array().parse(songs)),
		fetchPlaylists(http),
		fetchRadioStations(http)
	]);
	const albums = imported;
	const importedIds = new Set(imported.map((album) => album.id));
	if (albums.length > Math.max(LIBRARY_SYNC.fullSyncChangedAlbumMin, localAlbums * LIBRARY_SYNC.fullSyncChangedAlbumShare)) return null;
	const listeningChanged = albumPlays.length + albumStars.length + songPlays.length + songStars.length > 0;
	const stale = playlists.filter(
		(playlist) =>
			sync.playlists[playlist.id] !== playlistSignature(playlist) ||
			// Smart playlists may change with any new album, or with listening if their rules use it.
			(playlist.rules && (albums.length > 0 || (listeningChanged && followsListening(playlist.rules))))
	);
	const [albumSongs, playlistTracks, totals, artistArt] = await Promise.all([
		fetchAlbumSongs(
			http,
			albums.filter((album) => !album.missing).map((album) => album.id)
		),
		Promise.all(stale.map(async (playlist) => [playlist.id, await fetchPlaylistTracks(http, playlist)] as const)),
		// Totals only matter when content changed; the worker compares them to catch missed changes.
		albums.length ? Promise.all([fetchTotal(http, 'album?missing=false'), fetchTotal(http, 'song?missing=false')]) : null,
		albums.length ? fetchArtistArt(http) : refreshedArtistIds.length ? fetchArtistArt(http, refreshedArtistIds) : []
	]);
	const latest = <T extends { id: string }>(lists: T[][]) => [...new Map(lists.flat().map((item) => [item.id, item])).values()];
	return {
		albums,
		albumSongs,
		albumStats: latest([albumPlays, albumStars]),
		songStats: latest([songPlays, songStars]),
		// Imported albums are fully replaced anyway.
		artwork: refreshed.filter((album) => !importedIds.has(album.id)),
		artistArt,
		ratings: new Map(rated.map((song) => [song.id, song.rating])),
		marks: {
			albumImported: newest([marks.albumImported, ...albums.map((album) => album.importedAt)]),
			albumPlayed: newest([marks.albumPlayed, ...albumPlays.map((album) => album.playDate)]),
			albumStarred: newest([marks.albumStarred, ...albumStars.map((album) => album.starredAt)]),
			songPlayed: newest([marks.songPlayed, ...songPlays.map((song) => song.playDate)]),
			songStarred: newest([marks.songStarred, ...songStars.map((song) => song.starredAt)])
		},
		playlists,
		playlistTracks: new Map(playlistTracks),
		radioStations,
		totals: totals && { albums: totals[0], tracks: totals[1] }
	};
}
