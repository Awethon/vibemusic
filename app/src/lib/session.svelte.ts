// Reactive sign-in state for the UI. Persistence and login live in navidrome/session.ts.

import { NavidromeHttp } from './navidrome/http.ts';
import type { Credentials } from './navidrome/credentials.ts';
import { forgetCredentials, loadCredentials, saveCredentials, watchCredentials } from './navidrome/session.ts';

export const session = $state<{ credentials: Credentials | null; expired: boolean }>({
	credentials: loadCredentials(),
	expired: false
});

export function signedIn(credentials: Credentials) {
	session.credentials = credentials;
	session.expired = false;
}

// Navidrome rotates its JWT on every native API response; keep the newest so a reload still works.
export function renewToken(token: string) {
	if (!session.credentials || session.credentials.token === token) return;
	session.credentials = { ...session.credentials, token };
	// Another tab may have signed out, or in as someone else, while this request was under way;
	// saving now would undo that.
	if (loadCredentials()?.userId === session.credentials.userId) saveCredentials(session.credentials);
}

// Tabs share the stored credentials, so each follows what the others do with them. A tab left
// open used to undo a sign-out made in another one by saving its next token. And only the leading
// tab syncs, so only its token is renewed: the others take it over here, or theirs runs out.
export function followOtherTabs() {
	watchCredentials((stored) => {
		const mine = session.credentials;
		if (!mine) return;
		// Signed out, or in as someone else: start over, like signOut does.
		if (stored?.userId !== mine.userId) location.reload();
		else session.credentials = stored;
	});
}

export function sessionExpired() {
	session.expired = true;
}

export function signOut() {
	forgetCredentials();
	// A reload is the simplest way to drop everything tied to the old user: the library worker,
	// the player and all cached state.
	location.reload();
}

export function requireCredentials(): Credentials {
	if (!session.credentials) throw new Error('Not signed in');
	return session.credentials;
}

// Built per call so it always uses the current credentials.
export const navidrome = () => new NavidromeHttp(requireCredentials(), renewToken);
