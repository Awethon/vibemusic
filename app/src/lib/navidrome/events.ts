import { LIBRARY_SYNC } from '../tuning.ts';

export type NavidromeEventHandlers = { changed: (albumIds: string[]) => void; live: (live: boolean) => void };

function albumIdsIn(data: string): string[] {
	try {
		const ids = (JSON.parse(data) as { album?: unknown }).album;
		return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && id !== '*') : [];
	} catch {
		return [];
	}
}

export function listenToNavidrome(token: () => string, handlers: NavidromeEventHandlers): () => void {
	let source: EventSource | null = null;
	let retryMs: number = LIBRARY_SYNC.eventRetryMinMs;
	let retryTimer: ReturnType<typeof setTimeout> | undefined;
	let silenceTimer: ReturnType<typeof setTimeout> | undefined;
	const connect = () => {
		const current = new EventSource(`/api/events?jwt=${encodeURIComponent(token())}`);
		source = current;
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
			silenceTimer = setTimeout(drop, LIBRARY_SYNC.eventSilenceMs);
		};
		current.addEventListener('keepAlive', heard);
		current.addEventListener('serverStart', () => {
			heard();
			handlers.changed([]);
		});
		current.addEventListener('refreshResource', (event) => {
			heard();
			handlers.changed(albumIdsIn((event as MessageEvent<string>).data));
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
