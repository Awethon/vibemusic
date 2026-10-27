import { NavidromeHttp } from './navidrome/http.ts';
import type { Credentials } from './navidrome/credentials.ts';
import { forgetCredentials, loadCredentials, saveCredentials } from './navidrome/session.ts';

export const session = $state<{ credentials: Credentials | null; expired: boolean }>({
	credentials: loadCredentials(),
	expired: false
});

export function signedIn(credentials: Credentials) {
	session.credentials = credentials;
	session.expired = false;
}

export function renewToken(token: string) {
	if (!session.credentials || session.credentials.token === token) return;
	session.credentials = { ...session.credentials, token };
	saveCredentials(session.credentials);
}

export function sessionExpired() {
	session.expired = true;
}

export function signOut() {
	forgetCredentials();
	location.reload();
}

export function requireCredentials(): Credentials {
	if (!session.credentials) throw new Error('Not signed in');
	return session.credentials;
}

export const navidrome = () => new NavidromeHttp(requireCredentials(), renewToken);
