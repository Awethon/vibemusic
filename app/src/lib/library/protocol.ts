// Messages between library.svelte.ts (main thread) and library.worker.ts. Errors carry flags
// because Error subclasses don't survive postMessage.

import type { Credentials } from '../navidrome/credentials.ts';
import type { GenrePlaylistConfig } from '../serverConfig.ts';
import type { Enrichment, EnrichmentRequest, LibraryMeta } from './snapshot.ts';

export type SqlParam = string | number | null;

export type SyncProgress = {
	albums: number;
	albumTotal: number;
	tracks: number;
	trackTotal: number;
	playlists: number;
	playlistTotal: number;
	building: boolean;
};

export type SyncTimings = { fetchMs: number; buildMs: number; writeMs: number; snapshotBytes: number; steps: Record<string, number> };

export type WorkerRequest =
	| { kind: 'configure'; genrePlaylists: GenrePlaylistConfig }
	| { kind: 'open'; userId: string }
	| { kind: 'reload' }
	| { kind: 'sync'; credentials: Credentials; full: boolean; albumIds: string[]; artistIds: string[] }
	| { kind: 'persist' }
	| { kind: 'query'; sql: string; params: SqlParam[] }
	// persist: whether to save afterwards. Only the leader tab saves; others just apply the change.
	| { kind: 'run'; sql: string; params: SqlParam[]; persist: boolean }
	| { kind: 'enrichmentRequest' }
	| { kind: 'enrich'; enrichment: Enrichment };

export type WorkerResults = {
	configure: null;
	open: LibraryMeta | null;
	reload: LibraryMeta | null;
	sync: { meta: LibraryMeta; token: string; timings: SyncTimings | null; changed: boolean };
	query: { columns: string[]; rows: SqlParam[][] };
	run: number;
	persist: number;
	enrichmentRequest: EnrichmentRequest;
	enrich: LibraryMeta;
};

export type WorkerEnvelope = { id: number; request: WorkerRequest };

export type WorkerReply =
	| { id: number; ok: true; value: unknown }
	| { id: number; ok: false; error: string; expired: boolean; unreachable: boolean }
	// Sent any number of times during a full sync, before the final reply with the same id.
	| { id: number; progress: SyncProgress };
