import type { NativeAlbum, NativePlaylist, NativePlaylistTrack, NativeSong } from '../navidrome/schemas.ts';

export type LibrarySnapshot = {
	albums: NativeAlbum[];
	songs: NativeSong[];
	playlists: NativePlaylist[];
	playlistTracks: Map<string, NativePlaylistTrack[]>;
	steps?: Record<string, number>;
};

export type SyncMarks = { albumImported: string; albumPlayed: string; albumStarred: string; songPlayed: string; songStarred: string };

export type LibraryChanges = {
	marks: SyncMarks;
	albums: NativeAlbum[];
	albumSongs: NativeSong[];
	albumStats: NativeAlbum[];
	songStats: NativeSong[];
	playlists: NativePlaylist[];
	playlistTracks: Map<string, NativePlaylistTrack[]>;
	totals: { albums: number; tracks: number } | null;
};

export type SyncState = {
	marks: SyncMarks;
	playlists: Record<string, string>;
	fullSyncAt: string;
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

export type EnrichmentRequest = { since: number; releaseGroups: string[]; artists: { id: string; name: string; songs: string[]; albums: string[] }[]; mbSearch: { id: string; name: string; albums: string[] }[] };

export type Enrichment = {
	at: number;
	releaseGroups: Record<string, { artists: string[]; tags: [string, number][] } | null>;
	mbArtists: Record<string, { tags: [string, number][]; countries?: string[] | null } | null>;
	artistMatches?: Record<string, string | null>;
	apple?: Record<string, string[] | null>;
	deezer: Record<string, { id: number; name: string; fans: number; top: [string, number][]; albums?: [string, number][] | null } | null>;
};
