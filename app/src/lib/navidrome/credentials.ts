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

export function subsonicUrl(credentials: Credentials, method: string, params: Record<string, string | number | string[]> = {}): string {
	const query = subsonicAuthParams(credentials);
	for (const [name, value] of Object.entries(params)) {
		if (Array.isArray(value)) value.forEach((item) => query.append(name, item));
		else query.set(name, String(value));
	}
	return `/rest/${method}?${query}`;
}

export const streamUrl = (credentials: Credentials, trackId: string) => subsonicUrl(credentials, 'stream', { id: trackId, format: 'raw' });

export const coverUrl = (credentials: Credentials, albumId: string, size: number) => subsonicUrl(credentials, 'getCoverArt', { id: `al-${albumId}`, size });
