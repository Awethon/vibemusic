import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEADER_LEASE } from '../tuning.ts';
import { leadWhenFree } from './lease.ts';

// Each leadWhenFree call stands for one tab; they share this localStorage like tabs of one origin.
function openTab() {
	const tab = { leading: false, started: 0, stopped: 0 };
	leadWhenFree('test', () => {
		tab.leading = true;
		tab.started += 1;
		return () => {
			tab.leading = false;
			tab.stopped += 1;
		};
	});
	return tab;
}

describe('leadWhenFree', () => {
	beforeEach(() => {
		const items = new Map<string, string>();
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => items.get(key) ?? null,
			setItem: (key: string, value: string) => items.set(key, value),
			removeItem: (key: string) => items.delete(key)
		});
		vi.stubGlobal('addEventListener', () => {});
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('lets one tab lead while it keeps renewing the lease', () => {
		const first = openTab();
		vi.advanceTimersByTime(LEADER_LEASE.settleMs);
		const second = openTab();
		vi.advanceTimersByTime(LEADER_LEASE.ttlMs * 3);
		expect(first).toEqual({ leading: true, started: 1, stopped: 0 });
		expect(second).toEqual({ leading: false, started: 0, stopped: 0 });
	});

	it('makes a leader step down when another tab took over while it could not renew', () => {
		const first = openTab();
		vi.advanceTimersByTime(LEADER_LEASE.settleMs);
		// The computer sleeps: the clock moves past the lease, but no timer of the first tab runs.
		vi.setSystemTime(Date.now() + LEADER_LEASE.ttlMs + 1000);
		const second = openTab();
		vi.advanceTimersByTime(LEADER_LEASE.settleMs);
		expect(second.leading).toBe(true);
		// The first tab's next renewal finds the lease taken.
		vi.advanceTimersByTime(LEADER_LEASE.renewMs);
		expect(first).toEqual({ leading: false, started: 1, stopped: 1 });
		vi.advanceTimersByTime(LEADER_LEASE.ttlMs * 3);
		expect(first.leading).toBe(false);
		expect(second).toEqual({ leading: true, started: 1, stopped: 0 });
	});
});
