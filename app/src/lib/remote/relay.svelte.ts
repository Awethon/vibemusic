// WebSocket client for the relay server: identifies this tab as a device, keeps the device list
// and the active device id, reconnects with backoff, and passes messages to the player.
// Devices are grouped per Navidrome user.

import { session } from '../session.svelte.ts';
import type { Enrichment, EnrichmentRequest } from '../library/snapshot.ts';
import { randomId } from '../randomId.ts';
import { REMOTE } from '../tuning.ts';

export type Device = { id: string; name: string; online: boolean };

// The relay's WebSocket protocol. relay/src/protocol.rs defines the same messages on the
// server side and explains the flow; change both together. Queue, playback and command bodies
// are this app's own types; the relay stores and forwards them without reading them.

export type RelayRequest =
	| { type: 'hello'; token: string; deviceId: string; name: string }
	| { type: 'ping' }
	| { type: 'claim' }
	| { type: 'queue'; queue: unknown }
	| { type: 'playback'; playback: unknown }
	| { type: 'command'; command: unknown }
	| { type: 'transfer'; to: string }
	| { type: 'handoff'; to: string | null; queue: unknown; playback: unknown }
	| ({ type: 'enrich' } & EnrichmentRequest);

export type RelayMessage =
	| { type: 'welcome'; devices: Device[]; active: string | null; queue: unknown; playback: unknown; ageMs: number }
	| { type: 'devices'; devices: Device[]; active: string | null }
	| { type: 'queue'; queue: unknown }
	| { type: 'playback'; playback: unknown; ageMs: number }
	| { type: 'command'; command: unknown; from: string }
	| { type: 'release'; to: string; handoff: boolean }
	| { type: 'takeover'; queue: unknown; playback: unknown; ageMs: number }
	| ({ type: 'enrichment' } & Enrichment)
	| { type: 'unauthorized' };

const DEVICE_KEY = 'vibemusic.device';
const DEVICE_CHANNEL = 'vibemusic-devices';

export const relay = $state<{ connected: boolean; deviceId: string; devices: Device[]; active: string | null }>({
	connected: false,
	deviceId: '',
	devices: [],
	active: null
});

let socket: WebSocket | null = null;
let listener: (message: RelayMessage) => void = () => {};
const extraListeners = new Set<(message: RelayMessage) => void>();

export function listenToRelay(onMessage: (message: RelayMessage) => void) {
	extraListeners.add(onMessage);
	return () => extraListeners.delete(onMessage);
}
let retryMs: number = REMOTE.reconnectMinMs;

function browserName(agent: string) {
	if (/Edg\//.test(agent)) return 'Edge';
	if (/Firefox\//.test(agent)) return 'Firefox';
	if (/CriOS|Chrome\//.test(agent)) return 'Chrome';
	if (/Safari\//.test(agent)) return 'Safari';
	return 'Browser';
}

function systemName(agent: string) {
	if (/iPhone/.test(agent)) return 'iPhone';
	if (/iPad/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)) return 'iPad';
	if (/Android/.test(agent)) return 'Android';
	if (/Mac OS X/.test(agent)) return 'Mac';
	if (/Windows/.test(agent)) return 'Windows';
	if (/Linux/.test(agent)) return 'Linux';
	return '';
}

export function deviceName() {
	const agent = navigator.userAgent;
	return [browserName(agent), systemName(agent)].filter(Boolean).join(' · ');
}

// A device id is per tab, kept in sessionStorage. A duplicated tab copies sessionStorage, so the id
// is guarded by a Web Lock held for the tab's lifetime; a tab that can't get the lock picks a new id.
async function lockedDeviceId(stored: string | null): Promise<string> {
	for (const id of [...(stored ? [stored] : []), randomId()]) {
		const held = await new Promise<boolean>((resolve) => {
			void navigator.locks.request(`vibemusic-device-${id}`, { ifAvailable: true }, (lock) => {
				resolve(!!lock);
				// Never resolves, so the lock is held until the tab closes.
				return lock ? new Promise(() => {}) : undefined;
			});
		});
		if (held) return id;
	}
	throw new Error('No device id');
}

// Fallback without Web Locks (they need a secure context, so plain-http setups): ask the other
// tabs over BroadcastChannel whether the stored id is taken, and answer for our own id afterwards.
async function announcedDeviceId(stored: string | null): Promise<string> {
	const channel = new BroadcastChannel(DEVICE_CHANNEL);
	let taken = false;
	const listen = (event: MessageEvent<{ taken?: string }>) => {
		if (stored && event.data.taken === stored) taken = true;
	};
	channel.addEventListener('message', listen);
	if (stored) {
		channel.postMessage({ asking: stored });
		await new Promise((resolve) => setTimeout(resolve, REMOTE.deviceProbeMs));
	}
	channel.removeEventListener('message', listen);
	const id = stored && !taken ? stored : randomId();
	channel.addEventListener('message', (event: MessageEvent<{ asking?: string }>) => {
		if (event.data.asking === id) channel.postMessage({ taken: id });
	});
	return id;
}

async function claimDeviceId(): Promise<string> {
	const stored = sessionStorage.getItem(DEVICE_KEY);
	const id = navigator.locks ? await lockedDeviceId(stored) : await announcedDeviceId(stored);
	sessionStorage.setItem(DEVICE_KEY, id);
	return id;
}

function connect() {
	const token = session.credentials?.token;
	if (!token) return;
	const url = new URL('/relay', location.href);
	url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
	const current = new WebSocket(url);
	socket = current;
	current.addEventListener('open', () => {
		current.send(JSON.stringify({ type: 'hello', token, deviceId: relay.deviceId, name: deviceName() } satisfies RelayRequest));
	});
	current.addEventListener('message', (event) => {
		const message = JSON.parse(event.data as string) as RelayMessage;
		if (message.type === 'welcome') {
			relay.connected = true;
			retryMs = REMOTE.reconnectMinMs;
		}
		if (message.type === 'welcome' || message.type === 'devices') {
			relay.devices = message.devices;
			relay.active = message.active;
		}
		listener(message);
		for (const extra of extraListeners) extra(message);
	});
	current.addEventListener('close', () => {
		if (socket !== current) return;
		socket = null;
		relay.connected = false;
		setTimeout(connect, retryMs);
		retryMs = Math.min(REMOTE.reconnectMaxMs, retryMs * 2);
	});
}

export async function startRelay(onMessage: (message: RelayMessage) => void) {
	if (relay.deviceId) return;
	listener = onMessage;
	relay.deviceId = await claimDeviceId();
	connect();
	// Keeps idle connections from being closed by proxies along the way.
	setInterval(() => sendToRelay({ type: 'ping' }), REMOTE.keepAliveMs);
}

export function sendToRelay(message: RelayRequest) {
	if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

export const deviceById = (id: string | null) => relay.devices.find((device) => device.id === id) ?? null;

export const activeIsOnline = () => !!deviceById(relay.active)?.online;

export const isActiveElsewhere = () => relay.connected && !!relay.active && relay.active !== relay.deviceId && activeIsOnline();

export const onlineDevices = () => relay.devices.filter((device) => device.online || device.id === relay.deviceId);
