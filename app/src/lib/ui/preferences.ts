// Small UI preferences in localStorage. Access can throw (storage disabled or blocked), so every
// call falls back quietly, and unknown stored values are ignored.
const PREFIX = 'vibemusic.';

export function readPreference<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
	try {
		const value = localStorage.getItem(PREFIX + name);
		return allowed.includes(value as T) ? (value as T) : fallback;
	} catch {
		return fallback;
	}
}

export function writePreference(name: string, value: string) {
	try {
		localStorage.setItem(PREFIX + name, value);
	} catch {
		return;
	}
}
