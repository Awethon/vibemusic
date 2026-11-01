// Tracks whether Navidrome is reachable. http.ts reports every request's outcome here; while
// unreachable we ping on a timer, and onReconnect listeners run when the server answers again.

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
	// No need to act on the result: any request that gets through calls reportReachable via
	// watchReachability, which clears this timer and wakes the reconnect listeners.
	retryTimer = setInterval(() => void checkConnection(), CONNECTION.retryMs);
}

export async function checkConnection(): Promise<boolean> {
	try {
		await navidrome().subsonic('ping');
		return true;
	} catch (error) {
		// Any answer from the server (even an auth error) means it is reachable.
		return !isUnreachable(error);
	}
}

export function watchConnection() {
	watchReachability((reachable) => (reachable ? reportReachable() : reportUnreachable()));
}
