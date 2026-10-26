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
