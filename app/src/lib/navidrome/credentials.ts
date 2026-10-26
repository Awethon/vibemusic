export type Credentials = {
	userId: string;
	username: string;
	displayName: string;
	isAdmin: boolean;
	token: string;
	subsonicSalt: string;
	subsonicToken: string;
};

export class SessionExpiredError extends Error {
	constructor() {
		super('Navidrome session expired');
	}
}

export class NavidromeError extends Error {}

export class NavidromeUnreachableError extends NavidromeError {
	constructor() {
		super('Navidrome isn’t reachable');
	}
}

const UNREACHABLE_STATUSES = new Set([502, 503, 504]);

export async function reachNavidrome(input: string, init?: RequestInit): Promise<Response> {
	let response: Response;
	try {
		response = await fetch(input, init);
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') throw error;
		throw new NavidromeUnreachableError();
	}
	if (UNREACHABLE_STATUSES.has(response.status)) throw new NavidromeUnreachableError();
	return response;
}

const SUBSONIC_VERSION = '1.16.1';
const CLIENT_NAME = 'vibemusic';

export function subsonicAuthParams(credentials: Credentials): URLSearchParams {
	return new URLSearchParams({
		u: credentials.username,
		t: credentials.subsonicToken,
		s: credentials.subsonicSalt,
		v: SUBSONIC_VERSION,
		c: CLIENT_NAME
	});
}

export type SubsonicParams = Record<string, string | number | string[]>;

export function appendParams(target: URLSearchParams, params: SubsonicParams) {
	for (const [name, value] of Object.entries(params)) {
		if (Array.isArray(value)) value.forEach((item) => target.append(name, item));
		else target.set(name, String(value));
	}
	return target;
}

export const subsonicUrl = (credentials: Credentials, method: string, params: SubsonicParams = {}) => `/rest/${method}?${appendParams(subsonicAuthParams(credentials), params)}`;

export const streamUrl = (credentials: Credentials, trackId: string) => subsonicUrl(credentials, 'stream', { id: trackId, format: 'raw' });

export const coverAlbumOverrides = new Map<string, string>();

export const coverUrl = (credentials: Credentials, albumId: string, size: number) =>
	subsonicUrl(credentials, 'getCoverArt', { id: `al-${coverAlbumOverrides.get(albumId) ?? albumId}`, size });

export const playlistCoverUrl = (credentials: Credentials, playlistId: string, image: string, size: number) =>
	subsonicUrl(credentials, 'getCoverArt', { id: `pl-${playlistId}`, size, v: image });
