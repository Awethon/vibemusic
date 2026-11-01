// HTTP client for Navidrome. `native*` methods use the web UI's REST API (/api, JWT auth), which
// supports paging, sorting and filters the library sync relies on; `subsonic` uses /rest.
// Every request reports reachability to connection.svelte.ts.

import { randomId } from '../randomId.ts';
import {
	appendParams,
	NavidromeError,
	NavidromeNotImplementedError,
	NavidromeUnreachableError,
	reachNavidrome,
	SessionExpiredError,
	subsonicUrl,
	type Credentials,
	type SubsonicParams
} from './credentials.ts';

export type NativePage<T> = { items: T[]; total: number };

export type TokenListener = (token: string) => void;

const TOKEN_HEADER = 'x-nd-authorization';
const CLIENT_ID_HEADER = 'x-nd-client-unique-id';
const CLIENT_ID_KEY = 'vibemusic.client-id';

// Sent as X-ND-Client-Unique-Id so Navidrome doesn't echo our own changes (stars, plays, playlist
// edits) back to us as events. Navidrome also stores it in a cookie, which is how the EventSource
// connection (no custom headers) gets identified. Shared by all tabs of this browser.
const clientId = (() => {
	try {
		const stored = localStorage.getItem(CLIENT_ID_KEY);
		if (stored) return stored;
		const created = randomId();
		localStorage.setItem(CLIENT_ID_KEY, created);
		return created;
	} catch {
		return '';
	}
})();

let reachability: (reachable: boolean) => void = () => {};

export function watchReachability(listener: (reachable: boolean) => void) {
	reachability = listener;
}

async function request(input: string, init: RequestInit): Promise<Response> {
	const headers = new Headers(init.headers);
	if (clientId) headers.set(CLIENT_ID_HEADER, clientId);
	try {
		const response = await reachNavidrome(input, { ...init, headers });
		reachability(true);
		return response;
	} catch (error) {
		if (error instanceof NavidromeUnreachableError) reachability(false);
		throw error;
	}
}

export class NavidromeHttp {
	constructor(
		private credentials: Credentials,
		private onToken: TokenListener = () => {}
	) {}

	get current(): Credentials {
		return this.credentials;
	}

	async native(path: string, init: RequestInit = {}): Promise<Response> {
		const headers = new Headers(init.headers);
		headers.set(TOKEN_HEADER, `Bearer ${this.credentials.token}`);
		const response = await request(`/api/${path}`, { ...init, headers });
		if (response.status === 401) throw new SessionExpiredError();
		if (!response.ok) throw new NavidromeError(`Navidrome ${path}: ${response.status}`);
		// Navidrome returns a refreshed JWT on every native API response; keeping it extends the session.
		const renewed = response.headers.get(TOKEN_HEADER)?.replace(/^Bearer /, '');
		if (renewed && renewed !== this.credentials.token) {
			this.credentials = { ...this.credentials, token: renewed };
			this.onToken(renewed);
		}
		return response;
	}

	async nativeJson<T>(path: string, init?: RequestInit): Promise<T> {
		return (await this.native(path, init)).json() as Promise<T>;
	}

	// Navidrome's native API pages with _start/_end (end exclusive) and reports the total in x-total-count.
	async nativePage(path: string, start: number, end: number): Promise<NativePage<unknown>> {
		const separator = path.includes('?') ? '&' : '?';
		const response = await this.native(`${path}${separator}_start=${start}&_end=${end}`);
		const items = (await response.json()) as unknown[];
		return { items, total: Number(response.headers.get('x-total-count') ?? items.length) };
	}

	async nativeAll(path: string, pageSize: number, onPage: (loaded: number, total: number) => void = () => {}): Promise<unknown[]> {
		const first = await this.nativePage(path, 0, pageSize);
		const items = [...first.items];
		onPage(items.length, first.total);
		while (items.length < first.total) {
			const page = await this.nativePage(path, items.length, items.length + pageSize);
			// The library can shrink while we page through it; stop instead of looping on empty pages.
			if (!page.items.length) break;
			items.push(...page.items);
			onPage(items.length, first.total);
		}
		return items;
	}

	async subsonic<T = Record<string, unknown>>(method: string, params: SubsonicParams = {}): Promise<T> {
		const response = await request(subsonicUrl(this.credentials, method, { f: 'json' }), {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: appendParams(new URLSearchParams(), params)
		});
		if (response.status === 501) throw new NavidromeNotImplementedError(`Subsonic ${method}: 501`);
		if (!response.ok) throw new NavidromeError(`Subsonic ${method}: ${response.status}`);
		const body = (await response.json())['subsonic-response'];
		if (body?.status !== 'ok') {
			// Subsonic error 40: wrong username or password, i.e. the stored token no longer works.
			if (body?.error?.code === 40) throw new SessionExpiredError();
			throw new NavidromeError(`Subsonic ${method}: ${body?.error?.message ?? 'failed'}`);
		}
		return body as T;
	}
}
