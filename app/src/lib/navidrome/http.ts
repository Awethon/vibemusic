import { appendParams, NavidromeError, NavidromeUnreachableError, reachNavidrome, SessionExpiredError, subsonicUrl, type Credentials, type SubsonicParams } from './credentials.ts';

export type NativePage<T> = { items: T[]; total: number };

export type TokenListener = (token: string) => void;

const TOKEN_HEADER = 'x-nd-authorization';

let reachability: (reachable: boolean) => void = () => {};

export function watchReachability(listener: (reachable: boolean) => void) {
	reachability = listener;
}

async function request(input: string, init: RequestInit): Promise<Response> {
	try {
		const response = await reachNavidrome(input, init);
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
		if (!response.ok) throw new NavidromeError(`Subsonic ${method}: ${response.status}`);
		const body = (await response.json())['subsonic-response'];
		if (body?.status !== 'ok') {
			if (body?.error?.code === 40) throw new SessionExpiredError();
			throw new NavidromeError(`Subsonic ${method}: ${body?.error?.message ?? 'failed'}`);
		}
		return body as T;
	}
}
