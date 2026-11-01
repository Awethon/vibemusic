// Recently played albums, artists and playlists ("jump back in"), kept per browser in localStorage.

import { HISTORY } from './tuning.ts';

export type HistoryKind = 'album' | 'artist' | 'playlist';
export type HistoryItem = { kind: HistoryKind; id: string };

const STORAGE_KEY = 'vibemusic.history';

function load(): HistoryItem[] {
	try {
		return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as HistoryItem[];
	} catch {
		return [];
	}
}

export const history = $state<{ items: HistoryItem[] }>({ items: load() });

// List keys are "<kind>:<id>" strings set by the track lists that started playback.
export function historyItemFromListKey(listKey: string): HistoryItem | null {
	const [prefix, id] = [listKey.slice(0, listKey.indexOf(':')), listKey.slice(listKey.indexOf(':') + 1)];
	if (!id) return null;
	if (prefix === 'album') return { kind: 'album', id };
	if (prefix === 'playlist') return { kind: 'playlist', id };
	// "top" is the artist page's popular-tracks list, so it counts as playing the artist.
	if (prefix === 'artist' || prefix === 'top') return { kind: 'artist', id };
	return null;
}

export function rememberPlayedList(listKey: string) {
	const item = historyItemFromListKey(listKey);
	if (!item) return;
	history.items = [item, ...history.items.filter((existing) => existing.kind !== item.kind || existing.id !== item.id)].slice(
		0,
		HISTORY.maxLength
	);
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(history.items));
		// Storage can be full or blocked (private mode); history then just lasts for this page load.
	} catch {
		return;
	}
}

export function seedHistory(albumIds: string[]) {
	if (history.items.length) return;
	history.items = albumIds.slice(0, HISTORY.maxLength).map((id) => ({ kind: 'album', id }));
}
