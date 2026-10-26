import { NavidromeError, type Credentials } from './credentials.ts';

const STORAGE_KEY = `vibemusic.session:${NAVIDROME_TARGET}`;

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

export async function logIn(username: string, password: string): Promise<Credentials> {
	const response = await fetch('/auth/login', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ username, password })
	});
	if (response.status === 401) throw new NavidromeError('Wrong username or password');
	if (!response.ok) throw new NavidromeError(`Navidrome answered ${response.status}`);
	const body = (await response.json()) as LoginResponse;
	const credentials: Credentials = {
		userId: body.id,
		username: body.username,
		displayName: body.name,
		isAdmin: body.isAdmin,
		token: body.token,
		subsonicSalt: body.subsonicSalt,
		subsonicToken: body.subsonicToken
	};
	saveCredentials(credentials);
	return credentials;
}
