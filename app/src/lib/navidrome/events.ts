// Navidrome's server-sent event stream (/api/events). Only the library leader tab listens; events
// trigger an early incremental sync instead of waiting for the next poll.

import { LIBRARY_SYNC } from '../tuning.ts';

export type RefreshedIds = { albums: string[]; artists: string[] };

export type NavidromeEventHandlers = { changed: (refreshed: RefreshedIds) => void; live: (live: boolean) => void };

// "*" means "everything of this kind"; there is no id to refresh, the regular incremental sync covers it.
const idsOf = (value: unknown) => (Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && id !== '*') : []);

function refreshedIn(data: string): RefreshedIds {
	try {
		const resources = JSON.parse(data) as { album?: unknown; artist?: unknown };
		return { albums: idsOf(resources.album), artists: idsOf(resources.artist) };
	} catch {
		return { albums: [], artists: [] };
	}
}

/**
 * Keeps an EventSource open to Navidrome. `changed` fires with the album/artist ids Navidrome says
 * were refreshed (empty lists mean "something may have changed"); `live` reports whether the stream
 * is healthy so callers can poll less often. Returns a function that stops listening.
 */
export function listenToNavidrome(token: () => string, handlers: NavidromeEventHandlers): () => void {
	let source: EventSource | null = null;
	let retryMs: number = LIBRARY_SYNC.eventRetryMinMs;
	let retryTimer: ReturnType<typeof setTimeout> | undefined;
	let silenceTimer: ReturnType<typeof setTimeout> | undefined;
	const connect = () => {
		// EventSource can't send headers, so the JWT goes in the query. It is read again on every
		// reconnect because Navidrome rotates it.
		const current = new EventSource(`/api/events?jwt=${encodeURIComponent(token())}`);
		source = current;
		// We close and reconnect ourselves instead of relying on EventSource's built-in retry, which
		// would keep reusing the old (possibly expired) token and has no backoff.
		const drop = () => {
			clearTimeout(silenceTimer);
			current.close();
			handlers.live(false);
			retryTimer = setTimeout(connect, retryMs);
			retryMs = Math.min(retryMs * 2, LIBRARY_SYNC.eventRetryMaxMs);
		};
		const heard = () => {
			retryMs = LIBRARY_SYNC.eventRetryMinMs;
			handlers.live(true);
			clearTimeout(silenceTimer);
			// Navidrome sends keepAlive about every 15 s; a long silence means a dead connection that
			// the browser hasn't noticed (common behind proxies or after sleep).
			silenceTimer = setTimeout(drop, LIBRARY_SYNC.eventSilenceMs);
		};
		current.addEventListener('keepAlive', heard);
		// The server restarted (often after an upgrade or rescan): we may have missed events, so check.
		current.addEventListener('serverStart', () => {
			heard();
			handlers.changed({ albums: [], artists: [] });
		});
		current.addEventListener('refreshResource', (event) => {
			heard();
			handlers.changed(refreshedIn((event as MessageEvent<string>).data));
		});
		current.addEventListener('error', drop);
	};
	connect();
	return () => {
		clearTimeout(retryTimer);
		clearTimeout(silenceTimer);
		source?.close();
	};
}
