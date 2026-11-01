import { LEADER_LEASE } from '../tuning.ts';
import { randomId } from '../randomId.ts';

type Lease = { owner: string; until: number };

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
		setTimeout(() => {
			if (leading || read()?.owner !== me) return;
			leading = true;
			lead();
		}, LEADER_LEASE.settleMs);
	};
	attempt();
	setInterval(attempt, LEADER_LEASE.renewMs);
	addEventListener('storage', (event) => {
		if (event.key === key && !event.newValue) attempt();
	});
	addEventListener('pagehide', () => {
		if (leading && read()?.owner === me) localStorage.removeItem(key);
	});
	addEventListener('pageshow', (event) => {
		if (event.persisted && leading) claim();
	});
}
