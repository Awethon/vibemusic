import type { Credentials } from '../navidrome/credentials.ts';
import type { LibraryMeta } from './snapshot.ts';

export type SqlParam = string | number | null;

export type WorkerRequest =
	| { kind: 'open'; userId: string }
	| { kind: 'reload' }
	| { kind: 'sync'; credentials: Credentials }
	| { kind: 'query'; sql: string; params: SqlParam[] }
	| { kind: 'run'; sql: string; params: SqlParam[]; persist: boolean };

export type WorkerResults = {
	open: LibraryMeta | null;
	reload: LibraryMeta | null;
	sync: { meta: LibraryMeta; token: string };
	query: Record<string, SqlParam>[];
	run: number;
};

export type WorkerEnvelope = { id: number; request: WorkerRequest };

export type WorkerReply = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string; expired: boolean };
