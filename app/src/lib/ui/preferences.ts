// Small UI preferences in localStorage. Access can throw (storage disabled or blocked), so every
// call falls back quietly, and unknown stored values are ignored. A preference the visitor never
// set falls back to the instance default from /config.json, then to the built-in one.
import type { SettingDefaults } from '../serverConfig.ts';

const PREFIX = 'vibemusic.';

// Preference names behind each setting in config.json's "settings".
const PREFERENCE_NAMES: Record<keyof SettingDefaults, string> = {
	background: 'background',
	ripples: 'ripples',
	fullScreen: 'fs',
	sidebar: 'rail',
	artistView: 'artistView',
	timeline: 'nav.timeline',
	radio: 'nav.radio',
	glass: 'glass.enabled',
	glassLook: 'glass.look'
};

let instanceDefaults: Record<string, string> = {};

export function setPreferenceDefaults(settings: SettingDefaults) {
	instanceDefaults = Object.fromEntries(
		Object.entries(settings).map(([setting, value]) => [PREFERENCE_NAMES[setting as keyof SettingDefaults], value])
	);
}

// The instance's value as written, for settings that take more than a fixed list (a glass look code).
export const instanceSetting = (name: string): string | undefined => instanceDefaults[name];

function instanceDefault<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
	const value = instanceDefaults[name];
	return allowed.includes(value as T) ? (value as T) : fallback;
}

export function readPreference<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
	try {
		const value = localStorage.getItem(PREFIX + name);
		if (allowed.includes(value as T)) return value as T;
	} catch {
		// Storage unavailable: use the defaults.
	}
	return instanceDefault(name, allowed, fallback);
}

export function writePreference(name: string, value: string) {
	try {
		localStorage.setItem(PREFIX + name, value);
	} catch {
		return;
	}
}
