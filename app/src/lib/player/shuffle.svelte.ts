// Shuffle is remembered per album or playlist (by list key), like Spotify: turning it on for one
// list leaves every other list in order. Kept in this browser only.
import { writePreference } from '../ui/preferences.ts';

const NAME = 'shuffle';

function load(): Record<string, true> {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem('vibemusic.' + NAME) ?? '{}');
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, true>) : {};
	} catch {
		return {};
	}
}

const lists = $state(load());

export const shuffleFor = (listKey: string) => !!listKey && lists[listKey] === true;

export function rememberShuffle(listKey: string, on: boolean) {
	if (!listKey) return;
	if (on) lists[listKey] = true;
	else delete lists[listKey];
	writePreference(NAME, JSON.stringify(lists));
}
