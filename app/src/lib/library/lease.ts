// Leader election through a localStorage lease, for browsers without Web Locks (navigator.locks is
// missing on plain http, which isn't a secure context). library.svelte.ts prefers Web Locks.

import { LEADER_LEASE } from '../tuning.ts';
import { randomId } from '../randomId.ts';

type Lease = { owner: string; until: number };

/**
 * Calls `lead` once this tab wins the lease, then keeps renewing it until the page goes away.
 * Never gives leadership back while the tab is alive, matching the Web Lock path.
 */
export function leadWhenFree(name: string, lead: () => void) {
	const key = `vibemusic.lease:${name}`;
	const me = randomId();
	let leading = false;
	const read = (): Lease | null => {
		try {
			return JSON.parse(localStorage.getItem(key) ?? 'null') as Lease | null;
		} catch {
			return null;
		}
	};
	const claim = () => localStorage.setItem(key, JSON.stringify({ owner: me, until: Date.now() + LEADER_LEASE.ttlMs } satisfies Lease));
	const attempt = () => {
		const lease = read();
		if (leading) {
			claim();
			return;
		}
		if (lease && lease.owner !== me && lease.until > Date.now()) return;
		claim();
		// localStorage has no compare-and-set: two tabs can claim at the same moment. Wait, then
		// re-read; only the tab whose write survived becomes leader.
		setTimeout(() => {
			if (leading || read()?.owner !== me) return;
			leading = true;
			lead();
		}, LEADER_LEASE.settleMs);
	};
	attempt();
	setInterval(attempt, LEADER_LEASE.renewMs);
	// The leader removes the lease on pagehide, so other tabs can take over right away instead
	// of waiting for it to expire.
	addEventListener('storage', (event) => {
		if (event.key === key && !event.newValue) attempt();
	});
	addEventListener('pagehide', () => {
		if (leading && read()?.owner === me) localStorage.removeItem(key);
	});
	// Restored from the back/forward cache: we still think we lead, so take the lease back.
	addEventListener('pageshow', (event) => {
		if (event.persisted && leading) claim();
	});
}
