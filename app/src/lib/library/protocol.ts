import type { Credentials } from '../navidrome/credentials.ts';
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
	| { kind: 'open'; userId: string }
	| { kind: 'reload' }
	| { kind: 'sync'; credentials: Credentials; full: boolean; albumIds: string[]; artistIds: string[] }
	| { kind: 'persist' }
	| { kind: 'query'; sql: string; params: SqlParam[] }
	| { kind: 'run'; sql: string; params: SqlParam[]; persist: boolean }
	| { kind: 'enrichmentRequest' }
	| { kind: 'enrich'; enrichment: Enrichment };

export type WorkerResults = {
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
	| { id: number; progress: SyncProgress };
