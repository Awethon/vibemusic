// Credential types, error types and URL builders for Navidrome's Subsonic API. URLs carry the
// Subsonic token so they can be used directly in <img> and <audio>.

import { SvelteMap } from 'svelte/reactivity';
import { COVER_TIERS } from '../tuning.ts';

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

// Navidrome answers 501 for endpoints it leaves out, including ones its config turns off (sharing
// without EnableSharing).
export class NavidromeNotImplementedError extends NavidromeError {}

export class NavidromeUnreachableError extends NavidromeError {
	constructor() {
		super('Navidrome isn’t reachable');
	}
}

// What a reverse proxy answers when Navidrome behind it is down: treat it like a network failure.
const UNREACHABLE_STATUSES = new Set([502, 503, 504]);

export async function reachNavidrome(input: string, init?: RequestInit): Promise<Response> {
	let response: Response;
	try {
		response = await fetch(input, init);
	} catch (error) {
		// We cancelled it ourselves; that says nothing about the server.
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

export const subsonicUrl = (credentials: Credentials, method: string, params: SubsonicParams = {}) =>
	`/rest/${method}?${appendParams(subsonicAuthParams(credentials), params)}`;

// format=raw asks for the original file without transcoding. Radio "tracks" go to the relay's
// /radio endpoint instead of Navidrome.
export const streamUrl = (credentials: Credentials, trackId: string) =>
	trackId.startsWith('radio:')
		? `/radio/${encodeURIComponent(trackId.slice('radio:'.length))}?${subsonicAuthParams(credentials)}`
		: subsonicUrl(credentials, 'stream', { id: trackId, format: 'raw' });

// Covers are only requested in a few fixed sizes so components of similar size share one cached image.
const coverTier = (size: number) => COVER_TIERS.find((tier) => tier >= size) ?? COVER_TIERS[COVER_TIERS.length - 1];

export type AlbumArt = { hash: string; color: string; thumb: string };
export type ArtistArt = { color: string; thumb: string };

// Filled from the library database (library.svelte.ts). The image hash goes into cover URLs.
export const albumArt = new SvelteMap<string, AlbumArt>();
export const artistArt = new SvelteMap<string, ArtistArt>();

// "al-<id>_<imageHash>": Navidrome serves this with Cache-Control: immutable only when the hash
// matches the current cover. A replaced cover gets a new hash, hence a new URL, so the browser
// can cache covers forever without ever showing a stale one.
const albumCoverId = (albumId: string) => {
	const stamp = albumArt.get(albumId)?.hash;
	return `al-${albumId}${stamp ? `_${stamp}` : ''}`;
};

export const coverUrl = (credentials: Credentials, albumId: string, size: number) =>
	subsonicUrl(credentials, 'getCoverArt', { id: albumCoverId(albumId), size: coverTier(size) });

export const artistPhotoUrl = (credentials: Credentials, artistId: string, size: number) =>
	subsonicUrl(credentials, 'getCoverArt', { id: `ar-${artistId}`, size: coverTier(size) });

// Same "pl-<id>_<imageHash>" scheme as album covers: cached forever, new URL when the image changes.
export const playlistCoverUrl = (credentials: Credentials, playlistId: string, imageHash: string, size: number) =>
	subsonicUrl(credentials, 'getCoverArt', { id: `pl-${playlistId}_${imageHash}`, size: coverTier(size) });
