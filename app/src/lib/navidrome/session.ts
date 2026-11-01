import { NavidromeError, reachNavidrome, type Credentials } from './credentials.ts';
import { md5 } from './md5.ts';

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

export async function logIn(username: string, password: string): Promise<Credentials> {
	const response = await reachNavidrome('/auth/login', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ username, password })
	});
	if (response.status === 401) throw new NavidromeError('Wrong username or password');
	if (!response.ok) throw new NavidromeError(`Navidrome answered ${response.status}`);
	const body = (await response.json()) as LoginResponse;
	const salt = stableSalt(body.username, body.subsonicSalt);
	const credentials: Credentials = {
		userId: body.id,
		username: body.username,
		displayName: body.name,
		isAdmin: body.isAdmin,
		token: body.token,
		subsonicSalt: salt,
		subsonicToken: salt === body.subsonicSalt ? body.subsonicToken : md5(password + salt)
	};
	saveCredentials(credentials);
	return credentials;
}
