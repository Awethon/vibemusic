import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../library/queries.ts';
import { SCROBBLE } from '../tuning.ts';

class Unreachable extends Error {}

const subsonic = vi.fn<(method: string, params: Record<string, unknown>) => Promise<unknown>>();
const patchLibrary = vi.fn<() => Promise<void>>();

vi.mock('../session.svelte.ts', () => ({
	navidrome: () => ({ subsonic }),
	requireCredentials: () => ({ userId: 'user' })
}));
vi.mock('../library/library.svelte.ts', () => ({ patchLibrary: () => patchLibrary() }));
vi.mock('../connection.svelte.ts', () => ({ isUnreachable: (error: unknown) => error instanceof Unreachable }));

const { listened, resetListening, sendPendingScrobbles } = await import('./scrobbles.ts');

const track = { id: 'track', albumId: 'album' } as Track;
const DURATION = 200;
const plays = () => subsonic.mock.calls.filter(([, params]) => params.submission === 'true').length;

// Ten ticks a second, like the player's.
async function listen(seconds: number) {
	for (let tick = 0; tick < seconds * 10; tick++) {
		listened(track, 0.1, DURATION);
		await Promise.resolve();
		await Promise.resolve();
	}
}

beforeEach(() => {
	const stored = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => stored.get(key) ?? null,
		setItem: (key: string, value: string) => void stored.set(key, value),
		removeItem: (key: string) => void stored.delete(key)
	});
	subsonic.mockReset().mockResolvedValue({});
	patchLibrary.mockReset().mockResolvedValue();
	resetListening();
});

describe('scrobbles', () => {
	it('sends one play once half the track was heard', async () => {
		await listen(DURATION / 2 - 1);
		expect(plays()).toBe(0);
		await listen(30);
		expect(plays()).toBe(1);
	});

	it('waits before trying again when Navidrome refuses the play', async () => {
		subsonic.mockRejectedValue(new Error('refused'));
		await listen(DURATION / 2 + 1);
		expect(plays()).toBe(1);
		await listen(SCROBBLE.retryAfterSeconds - 2);
		expect(plays()).toBe(1);
		await listen(3);
		expect(plays()).toBe(2);
	});

	it('does not send the play again when only the local copy fails to update', async () => {
		patchLibrary.mockRejectedValue(new Error('worker'));
		await listen(DURATION / 2 + 40);
		expect(plays()).toBe(1);
	});

	it('keeps a play made while Navidrome is unreachable and sends it later', async () => {
		subsonic.mockRejectedValue(new Unreachable());
		await listen(DURATION / 2 + 40);
		expect(plays()).toBe(1);
		subsonic.mockReset().mockResolvedValue({});
		await sendPendingScrobbles();
		expect(plays()).toBe(1);
		await sendPendingScrobbles();
		expect(plays()).toBe(1);
	});
});
