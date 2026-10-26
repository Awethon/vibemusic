import { NavidromeUnreachableError } from './navidrome/credentials.ts';
import { watchReachability } from './navidrome/http.ts';
import { navidrome } from './session.svelte.ts';
import { CONNECTION } from './tuning.ts';

export const connection = $state({ unreachable: false });

const reconnectListeners: (() => void)[] = [];
let retryTimer: ReturnType<typeof setInterval> | undefined;

export const isUnreachable = (error: unknown) => error instanceof NavidromeUnreachableError;

export function onReconnect(listener: () => void) {
	reconnectListeners.push(listener);
}

export function reportReachable() {
	if (!connection.unreachable) return;
	connection.unreachable = false;
	clearInterval(retryTimer);
	for (const listener of reconnectListeners) listener();
}

export function reportUnreachable() {
	if (connection.unreachable) return;
	connection.unreachable = true;
	retryTimer = setInterval(() => void checkConnection(), CONNECTION.retryMs);
}

export async function checkConnection(): Promise<boolean> {
	try {
		await navidrome().subsonic('ping');
		return true;
	} catch (error) {
		return !isUnreachable(error);
	}
}

export function watchConnection() {
	watchReachability((reachable) => (reachable ? reportReachable() : reportUnreachable()));
}
