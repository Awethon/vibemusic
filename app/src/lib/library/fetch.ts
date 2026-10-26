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
	const playlistSignature = lists.map((playlist) => (playlist.rules ? playlist.id : `${playlist.id}:${playlist.updatedAt}:${playlist.songCount}`)).join(',');
	return `${status.scanStatus.lastScan ?? ''}|${playlistSignature}`;
}

export async function fetchLibrary(http: NavidromeHttp): Promise<LibrarySnapshot> {
	const playlists = await fetchPlaylists(http);
	const [version, albums, songs] = await Promise.all([
		fetchLibraryVersion(http, playlists),
		http.nativeAll('album?_sort=name&_order=ASC', PAGE_SIZE).then((items) => nativeAlbum.array().parse(items)),
		http.nativeAll('song?_sort=album&_order=ASC', PAGE_SIZE).then((items) => nativeSong.array().parse(items))
	]);
	const playlistTracks = new Map(
		await Promise.all(
			playlists.map(async (playlist) => [playlist.id, nativePlaylistTrack.array().parse(await http.nativeAll(`playlist/${playlist.id}/tracks?_sort=id&_order=ASC`, PAGE_SIZE))] as const)
		)
	);
	return { version, albums, songs, playlists, playlistTracks };
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
