import type { NativeAlbum, NativePlaylist, NativePlaylistTrack, NativeSong } from '../navidrome/schemas.ts';

export type LibrarySnapshot = {
	version: string;
	albums: NativeAlbum[];
	songs: NativeSong[];
	playlists: NativePlaylist[];
	playlistTracks: Map<string, NativePlaylistTrack[]>;
};

export type LibraryMeta = {
	version: string;
	syncedAt: string;
	userId: string;
	albums: number;
	artists: number;
	tracks: number;
	playlists: number;
};
