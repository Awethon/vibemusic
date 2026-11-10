// Playback rules against a stand-in for the audio engine: what happens to the queue, the messages
// and the scrobble count when a track fails, ends or is resumed.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../library/queries.ts';
import { CONNECTION } from '../tuning.ts';
import type { StartResult } from './engine.ts';
import { FakeEngine } from './fakeEngine.ts';

const fake = vi.hoisted(() => ({
	toasts: [] as string[],
	reachable: (): Promise<boolean> => Promise.resolve(true),
	resetListening: 0
}));

vi.mock('./engine.ts', () => ({ AudioEngine: FakeEngine }));
vi.mock('../connection.svelte.ts', () => ({ checkConnection: () => fake.reachable(), onReconnect: () => {} }));
vi.mock('../library/queries.ts', () => ({
	isRadio: (trackId: string | null | undefined) => !!trackId?.startsWith('radio:'),
	tracksByIds: async () => []
}));
vi.mock('../navidrome/credentials.ts', () => ({ streamUrl: (_credentials: unknown, trackId: string) => `/stream/${trackId}` }));
vi.mock('../session.svelte.ts', () => ({ requireCredentials: () => ({}) }));
vi.mock('../ui/state.svelte.ts', () => ({ showToast: (text: string) => void fake.toasts.push(text) }));
vi.mock('./mediaSession.ts', () => ({ installMediaSession: () => {}, updateMediaSession: () => {} }));
vi.mock('./radioNow.svelte.ts', () => ({ pollRadio: () => {} }));
vi.mock('./savedQueue.ts', () => ({ fetchSavedQueue: async () => null, saveIsDue: () => false, saveQueue: async () => {} }));
vi.mock('./scrobbles.ts', () => ({
	announceNowPlaying: () => {},
	listened: () => {},
	resetListening: () => void (fake.resetListening += 1),
	sendPendingScrobbles: async () => {}
}));

const IDS = ['a', 'b', 'c', 'd'];
const settle = () => new Promise((resolve) => setTimeout(resolve));
const networkDrop = { network: true, playing: true };

async function playing(mirroring = false) {
	vi.resetModules();
	vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
	const playback = await import('./playback.svelte.ts');
	const state = await import('./state.svelte.ts');
	state.remember(IDS.map((id) => ({ id, title: `Track ${id}`, albumId: 'album', duration: 200 }) as Track));
	playback.runLocally({ kind: 'playList', trackIds: IDS, startIndex: 0, sourceName: 'Album', listKey: 'album' });
	await settle();
	FakeEngine.latest.started();
	if (mirroring) playback.connectRemote({ mirroring: () => true, refreshed: () => {}, ticked: () => {} });
	return { ...playback, ...state, engine: FakeEngine.latest, current: () => state.queueState.currentTrackId };
}

beforeEach(() => {
	fake.toasts = [];
	fake.reachable = () => Promise.resolve(true);
	fake.resetListening = 0;
});

describe('a track that fails', () => {
	it('is loaded again where it stopped after a dropped connection, with its listening time kept', async () => {
		const { engine, current } = await playing();
		engine.position = 73;
		engine.fail(networkDrop);
		await settle();
		expect(engine.loads.at(-1)).toEqual({ trackId: 'a', autoplay: true, startAt: 73 });
		expect(current()).toBe('a');
		expect(fake.toasts).toEqual([]);
		// Starting the count over would let a long track be scrobbled twice.
		expect(fake.resetListening).toBe(1);
	});

	it('is skipped with a message when it breaks at the same place again', async () => {
		const { engine, current } = await playing();
		engine.position = 73;
		engine.fail(networkDrop);
		await settle();
		engine.started();
		engine.fail(networkDrop);
		await settle();
		expect(current()).toBe('b');
		expect(fake.toasts).toEqual(['Couldn’t play “Track a”, skipped']);
	});

	// A file cut short fails again right away, before the reload has got as far as playing.
	it('is skipped as well when the second break comes while it is still being loaded again', async () => {
		const { engine, current } = await playing();
		engine.position = 73;
		let finishLoad = (_result: StartResult) => {};
		engine.hold = new Promise((resolve) => (finishLoad = resolve));
		engine.fail(networkDrop);
		await settle();
		expect(engine.loads.at(-1)?.startAt).toBe(73);
		engine.fail(networkDrop);
		await settle();
		finishLoad('stopped');
		await settle();
		expect(current()).toBe('b');
		expect(fake.toasts).toEqual(['Couldn’t play “Track a”, skipped']);
	});

	it('starts nothing while paused, and plays from the same place when play is pressed', async () => {
		const { engine, current, runLocally, player } = await playing();
		engine.position = 40;
		engine.pause();
		const loads = engine.loads.length;
		engine.fail({ network: true, playing: false });
		await settle();
		expect([current(), engine.loads.length, fake.toasts]).toEqual(['a', loads, []]);
		expect(player.error).toBe('broken');

		runLocally({ kind: 'togglePlay' });
		await settle();
		expect(engine.loads.at(-1)).toEqual({ trackId: 'a', autoplay: true, startAt: 40 });
		expect(player.error).toBe('');
		// Still the same play of the same track.
		expect(fake.resetListening).toBe(1);
	});

	it('is left alone in a tab that only shows another device', async () => {
		const { engine, current, player } = await playing(true);
		const loads = engine.loads.length;
		engine.fail(networkDrop);
		await settle();
		expect([current(), engine.loads.length, fake.toasts, player.error]).toEqual(['a', loads, [], '']);
	});

	it('pauses with a message instead of skipping through the queue when Navidrome is away', async () => {
		const { engine, current } = await playing();
		fake.reachable = () => Promise.resolve(false);
		engine.fail(networkDrop);
		await settle();
		expect(current()).toBe('a');
		expect(engine.playing).toBe(false);
		expect(fake.toasts).toEqual(['Couldn’t play “Track a” — Navidrome isn’t reachable']);
	});

	it('does not skip the track the listener moved to while the connection was being checked', async () => {
		const { engine, current, runLocally } = await playing();
		let answer = (_reachable: boolean) => {};
		fake.reachable = () => new Promise((resolve) => (answer = resolve));
		engine.fail();
		await settle();
		runLocally({ kind: 'next' });
		await settle();
		expect(current()).toBe('b');
		answer(true);
		await settle();
		expect(current()).toBe('b');
		expect(fake.toasts).toEqual([]);
	});

	it('stops after several broken tracks in a row instead of running through the queue', async () => {
		const { engine, current } = await playing();
		for (let broken = 0; broken < CONNECTION.skipFailedTracksInRow; broken++) {
			engine.fail({ playing: true });
			await settle();
		}
		expect(current()).toBe(IDS[CONNECTION.skipFailedTracksInRow - 1]);
		expect(engine.playing).toBe(false);
		expect(fake.toasts.at(-1)).toContain('or the tracks before it');
	});

	it('counts broken tracks in a row only: one that played in between starts the count again', async () => {
		const { engine, current } = await playing();
		engine.fail({ playing: true });
		await settle();
		engine.started();
		for (let broken = 1; broken < CONNECTION.skipFailedTracksInRow; broken++) {
			engine.fail({ playing: true });
			await settle();
		}
		expect(current()).toBe(IDS[CONNECTION.skipFailedTracksInRow]);
		expect(engine.playing).toBe(true);
	});
});

describe('the queue', () => {
	it('moves on when a track ends, preloads the one after, and stops after the last', async () => {
		const { engine, current } = await playing();
		expect(engine.prepared.at(-1)).toBe('b');
		for (const next of ['b', 'c', 'd']) {
			engine.listener.ended();
			await settle();
			expect([current(), engine.loads.at(-1)?.trackId]).toEqual([next, next]);
			engine.started();
		}
		expect(engine.prepared.at(-1)).toBeNull();
		engine.listener.ended();
		await settle();
		expect(engine.stops).toBe(1);
		expect(engine.playing).toBe(false);
	});

	it('ends on the last track asked for when skips come faster than tracks load', async () => {
		const { engine, current, runLocally } = await playing();
		const finish: ((result: StartResult) => void)[] = [];
		for (let skip = 0; skip < 2; skip++) {
			engine.hold = new Promise((resolve) => finish.push(resolve));
			runLocally({ kind: 'next' });
		}
		// The first of the two loads was overtaken; the engine reports that as 'stopped'.
		finish[0]('stopped');
		finish[1]('playing');
		await settle();
		expect([current(), engine.trackId, engine.prepared.at(-1)]).toEqual(['c', 'c', 'd']);
	});
});
