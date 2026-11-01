// Shapes of the data moving between fetch.ts, build.ts and the worker.

import type { NativeAlbum, NativeArtist, NativePlaylist, NativePlaylistTrack, NativeSong, RadioStation } from '../navidrome/schemas.ts';

export type LibrarySnapshot = {
	albums: NativeAlbum[];
	songs: NativeSong[];
	playlists: NativePlaylist[];
	playlistTracks: Map<string, NativePlaylistTrack[]>;
	radioStations: RadioStation[];
	artists: NativeArtist[];
	steps?: Record<string, number>;
};

// Newest timestamps seen so far for each kind of change; the next incremental sync fetches only
// items newer than these.
export type SyncMarks = { albumImported: string; albumPlayed: string; albumStarred: string; songPlayed: string; songStarred: string };

export type LibraryChanges = {
	marks: SyncMarks;
	albums: NativeAlbum[];
	albumSongs: NativeSong[];
	albumStats: NativeAlbum[];
	// Albums named by refreshResource events. Only their artwork fields are applied: a play also
	// emits refreshResource, so a full album refetch would be wasted.
	artwork: NativeAlbum[];
	artistArt: NativeArtist[];
	songStats: NativeSong[];
	ratings: Map<string, number>;
	playlists: NativePlaylist[];
	playlistTracks: Map<string, NativePlaylistTrack[]>;
	// null when the request failed, meaning "keep what we have" rather than "there are none".
	radioStations: RadioStation[] | null;
	// Server-side counts, checked after applying; a mismatch forces a full sync.
	totals: { albums: number; tracks: number } | null;
};

export type SyncState = {
	marks: SyncMarks;
	// playlistSignature() per playlist id, to spot playlists whose tracks need refetching.
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

// Sent to the relay, which looks up genres and popularity on MusicBrainz, Deezer and Apple Music.
export type EnrichmentRequest = {
	since: number;
	releaseGroups: string[];
	artists: { id: string; name: string; songs: string[]; albums: string[] }[];
	mbSearch: { id: string; name: string; albums: string[] }[];
};

export type Enrichment = {
	at: number;
	releaseGroups: Record<string, { artists: string[]; tags: [string, number][] } | null>;
	mbArtists: Record<string, { tags: [string, number][]; countries?: string[] | null } | null>;
	artistMatches?: Record<string, string | null>;
	apple?: Record<string, string[] | null>;
	deezer: Record<string, { id: number; name: string; fans: number; top: [string, number][]; albums?: [string, number][] | null } | null>;
};
