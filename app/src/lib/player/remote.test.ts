// One device (this tab) with its real remote control, playback and queue code, a stand-in audio
// engine, and the relay replaced by a list of what was sent and a way to deliver messages.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../library/queries.ts';
import type { Device, RelayMessage, RelayRequest } from '../remote/relay.svelte.ts';
import { FakeEngine } from './fakeEngine.ts';
import * as queue from './queue.ts';

const net = vi.hoisted(() => ({
	relay: {
		connected: true,
		deviceId: 'here',
		devices: [] as { id: string; name: string; online: boolean }[],
		active: null as string | null
	},
	sent: [] as { type: string }[],
	deliver: (_message: unknown) => {},
	toasts: [] as string[],
	// Set by a test to hold back the lookup of track details.
	tracks: null as Promise<void> | null
}));

vi.mock('../remote/relay.svelte.ts', () => {
	const relay = net.relay;
	const activeIsOnline = () => !!relay.devices.find((device) => device.id === relay.active)?.online;
	return {
		relay,
		activeIsOnline,
		isActiveElsewhere: () => relay.connected && !!relay.active && relay.active !== relay.deviceId && activeIsOnline(),
		sendToRelay: (message: { type: string }) => void net.sent.push(message),
		startRelay: async (onMessage: (message: unknown) => void) => void (net.deliver = onMessage)
	};
});
vi.mock('./engine.ts', () => ({ AudioEngine: FakeEngine }));
vi.mock('../connection.svelte.ts', () => ({ checkConnection: async () => true, onReconnect: () => {} }));
vi.mock('../library/queries.ts', () => ({
	isRadio: (trackId: string | null | undefined) => !!trackId?.startsWith('radio:'),
	tracksByIds: async (ids: string[]) => {
		await net.tracks;
		return ids.map((id) => ({ id, title: `Track ${id}`, albumId: 'album', duration: 200, starred: false }) as Track);
	}
}));
vi.mock('../navidrome/credentials.ts', () => ({ streamUrl: (_credentials: unknown, trackId: string) => `/stream/${trackId}` }));
vi.mock('../session.svelte.ts', () => ({ requireCredentials: () => ({}) }));
vi.mock('../ui/state.svelte.ts', () => ({ showToast: (text: string) => void net.toasts.push(text) }));
vi.mock('./mediaSession.ts', () => ({ installMediaSession: () => {}, updateMediaSession: () => {} }));
vi.mock('./radioNow.svelte.ts', () => ({ pollRadio: () => {} }));
vi.mock('./savedQueue.ts', () => ({ fetchSavedQueue: async () => null, saveIsDue: () => false, saveQueue: async () => {} }));
vi.mock('./scrobbles.ts', () => ({
	announceNowPlaying: () => {},
	listened: () => {},
	resetListening: () => {},
	sendPendingScrobbles: async () => {}
}));

const settle = () => new Promise((resolve) => setTimeout(resolve));
const device = (id: string, online = true): Device => ({ id, name: id === 'here' ? 'Chrome · Mac' : 'Safari · iPhone', online });
const sentTypes = () => net.sent.map((message) => message.type);

// What another device would publish: its queue, and where it is in the current track.
function otherDevice(trackIds: string[], position: number, playing = true) {
	const state = queue.emptyQueue();
	queue.playList(state, trackIds, 0, 'Album', 'album');
	const playback = { trackId: trackIds[0], playing, position, duration: 200, volume: 0.8, muted: false, starred: false, waiting: false };
	return { queue: queue.copyQueue(state), playback };
}

async function tab() {
	vi.resetModules();
	vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
	Object.assign(net.relay, { connected: true, deviceId: 'here', devices: [], active: null });
	const remote = await import('./remote.svelte.ts');
	const state = await import('./state.svelte.ts');
	remote.startRemoteControl();
	await settle();
	// The real relay client updates the device list before it passes a message on.
	const receive = async (message: RelayMessage) => {
		if (message.type === 'welcome' || message.type === 'devices')
			Object.assign(net.relay, { devices: message.devices, active: message.active });
		net.deliver(message);
		await settle();
	};
	return { ...remote, ...state, receive, engine: () => FakeEngine.latest };
}

async function playingHere(page: Awaited<ReturnType<typeof tab>>, trackIds = ['a', 'b', 'c']) {
	await page.ensureTracks(trackIds);
	await page.receive({ type: 'welcome', devices: [device('here')], active: null, queue: null, playback: null, ageMs: 0 });
	page.perform({ kind: 'playList', trackIds, startIndex: 0, sourceName: 'Album', listKey: 'album' });
	await settle();
	page.engine().started();
	await page.receive({ type: 'devices', devices: [device('here')], active: 'here' });
}

async function mirroringThePhone(page: Awaited<ReturnType<typeof tab>>, position = 30) {
	const phone = otherDevice(['x', 'y', 'z'], position);
	await page.receive({ type: 'welcome', devices: [device('here'), device('phone')], active: 'phone', ...phone, ageMs: 0 });
	return phone;
}

beforeEach(() => {
	net.sent = [];
	net.toasts = [];
	net.tracks = null;
});

describe('after the relay restarts and has forgotten who was playing', () => {
	it('the tab that plays says so and publishes its queue and position', async () => {
		const page = await tab();
		await playingHere(page);
		net.sent = [];
		await page.receive({
			type: 'welcome',
			devices: [device('here'), device('phone')],
			active: null,
			queue: null,
			playback: null,
			ageMs: 0
		});
		expect(sentTypes()).toEqual(['claim']);
		await page.receive({ type: 'devices', devices: [device('here'), device('phone')], active: 'here' });
		expect(sentTypes()).toEqual(['claim', 'queue', 'playback']);
		expect(page.engine().playing).toBe(true);
	});

	// A claim from here makes the relay tell the device that really plays to stop.
	it('a tab that only showed another device does not claim to be the one playing', async () => {
		const page = await tab();
		await mirroringThePhone(page);
		expect(page.player.playing).toBe(true);
		net.sent = [];
		await page.receive({
			type: 'welcome',
			devices: [device('here'), device('phone')],
			active: null,
			queue: null,
			playback: null,
			ageMs: 0
		});
		expect(sentTypes()).toEqual([]);
		// Nothing plays as far as this tab knows, so it must not show a running track either.
		expect(page.player.playing).toBe(false);
		expect(page.engine().playing).toBe(false);
	});
});

describe('a tab that shows another device', () => {
	it('shows that device’s queue and position, and plays no audio itself', async () => {
		const page = await tab();
		await mirroringThePhone(page, 30);
		expect(page.isMirroring()).toBe(true);
		expect(page.queueState.currentTrackId).toBe('x');
		expect(page.player.position).toBe(30);
		expect(page.engine().loads).toEqual([]);
	});

	it('sends commands to that device instead of acting on them', async () => {
		const page = await tab();
		await mirroringThePhone(page);
		page.perform({ kind: 'next' });
		await settle();
		expect(net.sent).toEqual([{ type: 'command', command: { kind: 'next' } }]);
		expect(page.engine().loads).toEqual([]);
		// Shown at once, before the other device answers.
		expect(page.queueState.currentTrackId).toBe('y');
	});

	it('takes the queue over paused when that device goes away: nobody asked this tab to play', async () => {
		const page = await tab();
		await mirroringThePhone(page, 30);
		await page.receive({ type: 'devices', devices: [device('here'), device('phone', false)], active: 'phone' });
		expect(page.isMirroring()).toBe(false);
		expect(page.engine().loads).toEqual([{ trackId: 'x', autoplay: false, startAt: 30 }]);
		expect(page.engine().playing).toBe(false);
		expect(sentTypes()).toEqual([]);
	});

	it('plays here and claims playback when play is pressed after that device went away', async () => {
		const page = await tab();
		await mirroringThePhone(page, 30);
		await page.receive({ type: 'devices', devices: [device('here'), device('phone', false)], active: 'phone' });
		page.perform({ kind: 'togglePlay' });
		await settle();
		expect(sentTypes()).toEqual(['claim']);
		expect(page.engine().playing).toBe(true);
		expect(page.engine().trackId).toBe('x');
	});
});

describe('moving playback', () => {
	it('hands over the queue and the exact position, then goes quiet', async () => {
		const page = await tab();
		await playingHere(page);
		page.engine().position = 61.5;
		net.sent = [];
		await page.receive({ type: 'release', to: 'phone', handoff: true });
		const handoff = net.sent.find((message) => message.type === 'handoff') as Extract<RelayRequest, { type: 'handoff' }>;
		expect(handoff.to).toBe('phone');
		expect((handoff.playback as { position: number; playing: boolean; trackId: string }).position).toBe(61.5);
		expect((handoff.playback as { playing: boolean }).playing).toBe(true);
		expect((handoff.queue as queue.QueueState).currentTrackId).toBe('a');
		expect(page.engine().playing).toBe(false);
		expect(page.isMirroring()).toBe(true);
	});

	it('continues where the other device was, counting the time the message took', async () => {
		const page = await tab();
		await page.receive({
			type: 'welcome',
			devices: [device('here'), device('phone')],
			active: 'here',
			queue: null,
			playback: null,
			ageMs: 0
		});
		const phone = otherDevice(['x', 'y', 'z'], 40);
		await page.receive({ type: 'takeover', ...phone, ageMs: 2000 });
		expect(page.engine().loads).toEqual([{ trackId: 'x', autoplay: true, startAt: 42 }]);
		expect(page.queueState.currentTrackId).toBe('x');
		expect(sentTypes()).toContain('queue');
	});

	// Two devices playing at once: the takeover was still loading track details when playback moved on.
	it('does not start playing when playback has moved elsewhere before the takeover finished', async () => {
		const page = await tab();
		await page.receive({
			type: 'welcome',
			devices: [device('here'), device('phone')],
			active: 'here',
			queue: null,
			playback: null,
			ageMs: 0
		});
		let found = () => {};
		net.tracks = new Promise((resolve) => (found = resolve));
		const phone = otherDevice(['x', 'y', 'z'], 40);
		await page.receive({ type: 'takeover', ...phone, ageMs: 0 });
		await page.receive({ type: 'devices', devices: [device('here'), device('phone')], active: 'phone' });
		found();
		await settle();
		expect(page.isMirroring()).toBe(true);
		expect(page.engine().loads.filter((load) => load.autoplay)).toEqual([]);
		expect(page.engine().playing).toBe(false);
	});

	it('obeys a command from another device only while it is the one playing', async () => {
		const page = await tab();
		await playingHere(page);
		await page.receive({ type: 'command', command: { kind: 'next' }, from: 'phone' });
		expect(page.queueState.currentTrackId).toBe('b');

		const other = await tab();
		await mirroringThePhone(other);
		await other.receive({ type: 'command', command: { kind: 'next' }, from: 'phone' });
		expect(other.queueState.currentTrackId).toBe('x');
		expect(other.engine().loads).toEqual([]);
	});
});
