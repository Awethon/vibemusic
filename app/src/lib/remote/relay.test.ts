// The relay connection against a stand-in WebSocket: when it reconnects, and with which token.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REMOTE } from '../tuning.ts';

class FakeSocket extends EventTarget {
	static OPEN = 1;
	static all: FakeSocket[] = [];
	readyState = 0;
	sent: { type: string; token?: string }[] = [];

	constructor(public url: URL) {
		super();
		FakeSocket.all.push(this);
	}

	send(text: string) {
		this.sent.push(JSON.parse(text));
	}

	open() {
		this.readyState = FakeSocket.OPEN;
		this.dispatchEvent(new Event('open'));
	}

	receive(message: object) {
		this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(message) }));
	}

	drop() {
		this.readyState = 3;
		this.dispatchEvent(new Event('close'));
	}
}

const account = vi.hoisted(() => ({
	session: { credentials: { token: 'first' } as { token: string } | null, expired: false },
	keepalive: (): Promise<unknown> => Promise.resolve()
}));

vi.mock('../session.svelte.ts', () => ({
	session: account.session,
	navidrome: () => ({ native: () => account.keepalive() }),
	sessionExpired: () => void (account.session.expired = true)
}));

const latest = () => FakeSocket.all.at(-1)!;
const helloToken = (socket: FakeSocket) => socket.sent.find((message) => message.type === 'hello')?.token;
const welcome = { type: 'welcome', devices: [], active: null, queue: null, playback: null, ageMs: 0 };

async function connected() {
	vi.resetModules();
	const client = await import('./relay.svelte.ts');
	// The error class as this copy of the client knows it.
	const { SessionExpiredError } = await import('../navidrome/credentials.ts');
	await client.startRelay(() => {});
	latest().open();
	return { ...client, SessionExpiredError };
}

beforeEach(() => {
	vi.useFakeTimers();
	FakeSocket.all = [];
	Object.assign(account.session, { credentials: { token: 'first' }, expired: false });
	account.keepalive = () => Promise.resolve();
	vi.stubGlobal('WebSocket', FakeSocket);
	vi.stubGlobal('location', { href: 'http://music.test/', protocol: 'http:' });
	vi.stubGlobal('navigator', { userAgent: 'Chrome/1 Mac OS X', maxTouchPoints: 0 });
	vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {} });
	vi.stubGlobal(
		'BroadcastChannel',
		class {
			addEventListener() {}
			removeEventListener() {}
			postMessage() {}
		}
	);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('the relay connection', () => {
	it('tries again after a growing pause, and starts from a short one once it is welcomed', async () => {
		const client = await connected();
		latest().receive(welcome);
		expect(client.relay.connected).toBe(true);

		let pause: number = REMOTE.reconnectMinMs;
		for (let attempt = 0; attempt < 8; attempt++) {
			const before = FakeSocket.all.length;
			latest().drop();
			expect(client.relay.connected).toBe(false);
			await vi.advanceTimersByTimeAsync(pause - 1);
			expect(FakeSocket.all.length, `attempt ${attempt}`).toBe(before);
			await vi.advanceTimersByTimeAsync(1);
			expect(FakeSocket.all.length, `attempt ${attempt}`).toBe(before + 1);
			pause = Math.min(REMOTE.reconnectMaxMs, pause * 2);
		}
		expect(pause).toBe(REMOTE.reconnectMaxMs);

		latest().open();
		latest().receive(welcome);
		const before = FakeSocket.all.length;
		latest().drop();
		await vi.advanceTimersByTimeAsync(REMOTE.reconnectMinMs);
		expect(FakeSocket.all.length).toBe(before + 1);
	});

	it('asks Navidrome when the relay refuses the token, and waits for the answer before trying again', async () => {
		await connected();
		expect(helloToken(latest())).toBe('first');
		let answer = () => {};
		account.keepalive = () => new Promise<void>((resolve) => (answer = resolve));
		latest().receive({ type: 'unauthorized' });
		latest().drop();
		await vi.advanceTimersByTimeAsync(5 * 60_000);
		expect(FakeSocket.all).toHaveLength(1);

		// Navidrome's answer carries a renewed token, which the session takes over.
		account.session.credentials = { token: 'renewed' };
		answer();
		await vi.advanceTimersByTimeAsync(REMOTE.reconnectMinMs);
		expect(FakeSocket.all).toHaveLength(2);
		latest().open();
		expect(helloToken(latest())).toBe('renewed');
	});

	// It used to send the same dead token again every 30 seconds for as long as the tab stayed open.
	it('stops trying when the session has ended, and connects again after a new sign-in', async () => {
		const { SessionExpiredError } = await connected();
		account.keepalive = () => Promise.reject(new SessionExpiredError());
		latest().receive({ type: 'unauthorized' });
		latest().drop();
		await vi.advanceTimersByTimeAsync(10 * 60_000);
		expect(account.session.expired).toBe(true);
		expect(FakeSocket.all).toHaveLength(1);

		Object.assign(account.session, { credentials: { token: 'signed-in-again' }, expired: false });
		await vi.advanceTimersByTimeAsync(REMOTE.reconnectMaxMs);
		expect(FakeSocket.all).toHaveLength(2);
		latest().open();
		expect(helloToken(latest())).toBe('signed-in-again');
	});

	it('keeps trying with the same token while Navidrome can’t be reached to check it', async () => {
		await connected();
		account.keepalive = () => Promise.reject(new Error('unreachable'));
		latest().receive({ type: 'unauthorized' });
		latest().drop();
		await vi.advanceTimersByTimeAsync(REMOTE.reconnectMinMs);
		expect(account.session.expired).toBe(false);
		expect(FakeSocket.all).toHaveLength(2);
	});
});
