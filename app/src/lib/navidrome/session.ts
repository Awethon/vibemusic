// Logging in to Navidrome and keeping the credentials in localStorage.

import { NavidromeError, reachNavidrome, type Credentials } from './credentials.ts';
import { md5 } from './md5.ts';

// Keyed by server (the page origin in production, the proxied server in development) so
// sessions for different servers never mix.
const STORAGE_KEY = `vibemusic.session:${NAVIDROME_TARGET}`;
const SALT_KEY = `vibemusic.subsonic-salt:${NAVIDROME_TARGET}`;

type LoginResponse = {
	id: string;
	name: string;
	username: string;
	isAdmin: boolean;
	token: string;
	subsonicSalt: string;
	subsonicToken: string;
};

export function loadCredentials(): Credentials | null {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		return stored ? (JSON.parse(stored) as Credentials) : null;
	} catch {
		return null;
	}
}

export function saveCredentials(credentials: Credentials) {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials));
}

export function forgetCredentials() {
	localStorage.removeItem(STORAGE_KEY);
}

// Calls the listener when another tab saves or forgets the credentials (a key of null means the
// whole storage was cleared). The browser doesn't report a tab's own changes to it.
export function watchCredentials(listener: (credentials: Credentials | null) => void) {
	addEventListener('storage', (event) => {
		if (event.key === STORAGE_KEY || event.key === null) listener(loadCredentials());
	});
}

// The Subsonic token is md5(password + salt) and Navidrome accepts any salt. Keeping the salt
// stable per user keeps the token, and therefore every cover URL, the same across logins, so
// the browser's image cache stays valid.
function stableSalt(username: string, fallback: string): string {
	try {
		const salts = JSON.parse(localStorage.getItem(SALT_KEY) ?? '{}') as Record<string, string>;
		salts[username] ??= fallback;
		localStorage.setItem(SALT_KEY, JSON.stringify(salts));
		return salts[username];
	} catch {
		return fallback;
	}
}

async function signIn(response: Response, password: string): Promise<Credentials> {
	const body = (await response.json()) as LoginResponse;
	const salt = stableSalt(body.username, body.subsonicSalt);
	const credentials: Credentials = {
		userId: body.id,
		username: body.username,
		displayName: body.name,
		isAdmin: body.isAdmin,
		token: body.token,
		subsonicSalt: salt,
		// First login on this browser: the server's salt was just stored, so its token is right.
		subsonicToken: salt === body.subsonicSalt ? body.subsonicToken : md5(password + salt)
	};
	saveCredentials(credentials);
	return credentials;
}

const postJson = (path: string, body: unknown) =>
	reachNavidrome(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export async function logIn(username: string, password: string): Promise<Credentials> {
	const response = await postJson('/auth/login', { username, password });
	if (response.status === 401) throw new NavidromeError('Wrong username or password');
	if (!response.ok) throw new NavidromeError(`Navidrome answered ${response.status}`);
	return signIn(response, password);
}

export class AdminExistsError extends NavidromeError {
	constructor() {
		super('This server already has an account. Sign in with it.');
	}
}

// A new Navidrome has no users; its first account is created as admin. Navidrome checks nothing
// about the name or password, so callers must.
export async function createAdmin(username: string, password: string): Promise<Credentials> {
	const response = await postJson('/auth/createAdmin', { username, password });
	if (response.status === 403) throw new AdminExistsError();
	if (!response.ok) throw new NavidromeError(`Navidrome answered ${response.status}`);
	return signIn(response, password);
}

// Navidrome's web UI page (/app/) embeds the config its own first-run screen reads; firstTime is
// true while it has no users.
export function firstRunFromPage(html: string): boolean {
	const config = html.match(/__APP_CONFIG__\s*=\s*("(?:[^"\\]|\\.)*")/)?.[1];
	if (!config) return false;
	try {
		return (JSON.parse(JSON.parse(config) as string) as { firstTime?: boolean }).firstTime === true;
	} catch {
		return false;
	}
}

// Anything unexpected (no /app/ route, a proxy's page) means no.
export async function isFirstRun(): Promise<boolean> {
	try {
		const response = await fetch('/app/', { cache: 'no-cache' });
		return response.ok && firstRunFromPage(await response.text());
	} catch {
		return false;
	}
}
