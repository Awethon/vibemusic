import { session } from '../session.svelte.ts';
import type { Enrichment } from '../library/snapshot.ts';
import { REMOTE } from '../tuning.ts';

export type Device = { id: string; name: string; online: boolean };

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

async function claimDeviceId(): Promise<string> {
	const stored = sessionStorage.getItem(DEVICE_KEY);
	const candidates = stored ? [stored] : [];
	for (const id of [...candidates, crypto.randomUUID()]) {
		const held = await new Promise<boolean>((resolve) => {
			void navigator.locks.request(`vibemusic-device-${id}`, { ifAvailable: true }, (lock) => {
				resolve(!!lock);
				return lock ? new Promise(() => {}) : undefined;
			});
		});
		if (!held) continue;
		sessionStorage.setItem(DEVICE_KEY, id);
		return id;
	}
	throw new Error('No device id');
}

function connect() {
	const token = session.credentials?.token;
	if (!token) return;
	const url = new URL('/relay', location.href);
	url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
	const current = new WebSocket(url);
	socket = current;
	current.addEventListener('open', () => {
		current.send(JSON.stringify({ type: 'hello', token, deviceId: relay.deviceId, name: deviceName() }));
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
	setInterval(() => sendToRelay({ type: 'ping' }), REMOTE.keepAliveMs);
}

export function sendToRelay(message: object) {
	if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

export const deviceById = (id: string | null) => relay.devices.find((device) => device.id === id) ?? null;

export const activeIsOnline = () => !!deviceById(relay.active)?.online;

export const isActiveElsewhere = () => relay.connected && !!relay.active && relay.active !== relay.deviceId && activeIsOnline();

export const onlineDevices = () => relay.devices.filter((device) => device.online || device.id === relay.deviceId);
