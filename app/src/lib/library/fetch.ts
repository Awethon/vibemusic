import type { NavidromeHttp } from '../navidrome/http.ts';
import { nativeAlbum, nativePlaylist, nativePlaylistTrack, nativeSong, type NativePlaylist } from '../navidrome/schemas.ts';
import type { LibrarySnapshot } from './snapshot.ts';

const PAGE_SIZE = 5000;

type ScanStatus = { scanStatus: { lastScan?: string; scanning: boolean } };

export async function fetchPlaylists(http: NavidromeHttp): Promise<NativePlaylist[]> {
	return nativePlaylist.array().parse(await http.nativeAll('playlist?_sort=name&_order=ASC', PAGE_SIZE));
}

export async function fetchLibraryVersion(http: NavidromeHttp, playlists?: NativePlaylist[]): Promise<string> {
	const [status, lists] = await Promise.all([http.subsonic<ScanStatus>('getScanStatus'), playlists ?? fetchPlaylists(http)]);
	const playlistSignature = lists.map((playlist) => (playlist.rules ? `${playlist.id}:${playlist.uploadedImage}` : `${playlist.id}:${playlist.updatedAt}:${playlist.songCount}:${playlist.uploadedImage}`)).join(',');
	return `${status.scanStatus.lastScan ?? ''}|${playlistSignature}`;
}

export async function fetchLibrary(http: NavidromeHttp): Promise<LibrarySnapshot> {
	const steps: Record<string, number> = {};
	const timed = async <T>(step: string, work: () => Promise<T>): Promise<T> => {
		const started = performance.now();
		try {
			return await work();
		} finally {
			steps[step] = Math.round(performance.now() - started);
		}
	};
	const playlists = await timed('playlists', () => fetchPlaylists(http));
	const [version, albums, songs] = await Promise.all([
		timed('scan status', () => fetchLibraryVersion(http, playlists)),
		timed('albums', async () => nativeAlbum.array().parse(await http.nativeAll('album?_sort=name&_order=ASC', PAGE_SIZE))),
		timed('songs', async () => nativeSong.array().parse(await http.nativeAll('song?_sort=album&_order=ASC', PAGE_SIZE)))
	]);
	const playlistTracks = await timed(
		'playlist tracks',
		async () =>
			new Map(
				await Promise.all(
					playlists.map(
						async (playlist) =>
							[playlist.id, await timed(`playlist ${playlist.name}`, async () => nativePlaylistTrack.array().parse(await http.nativeAll(`playlist/${playlist.id}/tracks?_sort=id&_order=ASC`, PAGE_SIZE)))] as const
					)
				)
			)
	);
	return { version, albums, songs, playlists, playlistTracks, steps };
}

type RawSnapshot = { version: string; albums: unknown[]; songs: unknown[]; playlists: unknown[]; playlistTracks: Record<string, unknown[]> };

export async function fetchSnapshotFile(url: string): Promise<LibrarySnapshot> {
	const raw = (await (await fetch(url)).json()) as RawSnapshot;
	return {
		version: raw.version,
		albums: nativeAlbum.array().parse(raw.albums),
		songs: nativeSong.array().parse(raw.songs),
		playlists: nativePlaylist.array().parse(raw.playlists),
		playlistTracks: new Map(Object.entries(raw.playlistTracks).map(([id, tracks]) => [id, nativePlaylistTrack.array().parse(tracks)]))
	};
}
