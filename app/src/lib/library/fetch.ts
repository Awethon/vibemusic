import type { z } from 'zod';
import type { NavidromeHttp } from '../navidrome/http.ts';
import { nativeAlbum, nativePlaylist, nativePlaylistTrack, nativeSong, radioStation, type NativePlaylist, type NativePlaylistTrack, type RadioStation } from '../navidrome/schemas.ts';
import { LIBRARY_SYNC } from '../tuning.ts';
import { newest, playlistSignature } from './build.ts';
import type { SyncProgress } from './protocol.ts';
import type { LibraryChanges, LibrarySnapshot, SyncState } from './snapshot.ts';

export async function fetchPlaylists(http: NavidromeHttp): Promise<NativePlaylist[]> {
	return nativePlaylist.array().parse(await http.nativeAll('playlist?_sort=name&_order=ASC', LIBRARY_SYNC.pageSize));
}

type RadioResponse = { internetRadioStations?: { internetRadioStation?: unknown[] } };

async function fetchRadioStations(http: NavidromeHttp): Promise<RadioStation[] | null> {
	try {
		return radioStation.array().parse((await http.subsonic<RadioResponse>('getInternetRadioStations')).internetRadioStations?.internetRadioStation ?? []);
	} catch {
		return null;
	}
}

async function fetchPlaylistTracks(http: NavidromeHttp, playlist: NativePlaylist): Promise<NativePlaylistTrack[]> {
	return nativePlaylistTrack.array().parse(await http.nativeAll(`playlist/${playlist.id}/tracks?_sort=id&_order=ASC`, LIBRARY_SYNC.pageSize));
}

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
	const [albums, songs] = await Promise.all([
		timed('albums', async () => nativeAlbum.array().parse(await http.nativeAll('album?missing=false&_sort=name&_order=ASC', LIBRARY_SYNC.pageSize, (loaded, albumTotal) => report({ albums: loaded, albumTotal })))),
		timed('songs', async () => nativeSong.array().parse(await http.nativeAll('song?missing=false&_sort=album&_order=ASC', LIBRARY_SYNC.pageSize, (loaded, trackTotal) => report({ tracks: loaded, trackTotal }))))
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
	return { albums, songs, playlists, playlistTracks, radioStations: radioStations ?? [], steps };
}

async function changedSince<T>(http: NavidromeHttp, path: string, schema: z.ZodType<T>, stampOf: (item: T) => string, mark: string): Promise<T[]> {
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

async function fetchTotal(http: NavidromeHttp, path: string): Promise<number> {
	return (await http.nativePage(path, 0, 1)).total;
}

async function fetchAlbumSongs(http: NavidromeHttp, albumIds: string[]) {
	const batches: string[][] = [];
	for (let index = 0; index < albumIds.length; index += LIBRARY_SYNC.albumsPerSongRequest) batches.push(albumIds.slice(index, index + LIBRARY_SYNC.albumsPerSongRequest));
	const pages = await Promise.all(batches.map(async (ids) => nativeSong.array().parse(await http.nativeAll(`song?missing=false&${ids.map((id) => `album_id=${encodeURIComponent(id)}`).join('&')}&_sort=album&_order=ASC`, LIBRARY_SYNC.pageSize))));
	return pages.flat();
}

export async function fetchChanges(http: NavidromeHttp, sync: SyncState, localAlbums: number): Promise<LibraryChanges | null> {
	const { marks } = sync;
	const [albums, albumPlays, albumStars, songPlays, songStars, rated, playlists, radioStations] = await Promise.all([
		changedSince(http, 'album?_sort=importedAt&_order=DESC', nativeAlbum, (album) => album.importedAt, marks.albumImported),
		changedSince(http, 'album?_sort=playDate&_order=DESC', nativeAlbum, (album) => album.playDate, marks.albumPlayed),
		changedSince(http, 'album?_sort=starredAt&_order=DESC', nativeAlbum, (album) => album.starredAt, marks.albumStarred),
		changedSince(http, 'song?_sort=playDate&_order=DESC', nativeSong, (song) => song.playDate, marks.songPlayed),
		changedSince(http, 'song?_sort=starredAt&_order=DESC', nativeSong, (song) => song.starredAt, marks.songStarred),
		http.nativeAll('song?has_rating=true&_sort=title&_order=ASC', LIBRARY_SYNC.pageSize).then((songs) => nativeSong.array().parse(songs)),
		fetchPlaylists(http),
		fetchRadioStations(http)
	]);
	if (albums.length > Math.max(LIBRARY_SYNC.fullSyncChangedAlbumMin, localAlbums * LIBRARY_SYNC.fullSyncChangedAlbumShare)) return null;
	const libraryChanged = albums.length + albumPlays.length + albumStars.length + songPlays.length + songStars.length > 0;
	const stale = playlists.filter((playlist) => sync.playlists[playlist.id] !== playlistSignature(playlist) || (playlist.rules && libraryChanged));
	const [albumSongs, playlistTracks, totals] = await Promise.all([
		fetchAlbumSongs(http, albums.filter((album) => !album.missing).map((album) => album.id)),
		Promise.all(stale.map(async (playlist) => [playlist.id, await fetchPlaylistTracks(http, playlist)] as const)),
		albums.length ? Promise.all([fetchTotal(http, 'album?missing=false'), fetchTotal(http, 'song?missing=false')]) : null
	]);
	const latest = <T extends { id: string }>(lists: T[][]) => [...new Map(lists.flat().map((item) => [item.id, item])).values()];
	return {
		albums,
		albumSongs,
		albumStats: latest([albumPlays, albumStars]),
		songStats: latest([songPlays, songStars]),
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

type RawSnapshot = { albums: unknown[]; songs: unknown[]; playlists: unknown[]; playlistTracks: Record<string, unknown[]> };

export async function fetchSnapshotFile(url: string): Promise<LibrarySnapshot> {
	const raw = (await (await fetch(url)).json()) as RawSnapshot;
	return {
		albums: nativeAlbum.array().parse(raw.albums),
		songs: nativeSong.array().parse(raw.songs),
		playlists: nativePlaylist.array().parse(raw.playlists),
		playlistTracks: new Map(Object.entries(raw.playlistTracks).map(([id, tracks]) => [id, nativePlaylistTrack.array().parse(tracks)])),
		radioStations: []
	};
}
