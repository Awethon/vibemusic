// The user's glass settings, persisted in localStorage. On/off and the look (chosen preset plus
// tuned parameters) are stored apart, so turning glass on doesn't pin the look: a visitor who never
// tuned it follows the instance's default look.
import { BASE, DEFAULT_LOOK, LOOKS, lookFromCode, type GlassKey, type GlassParams } from './params.ts';
import { instanceSetting, readPreference, writePreference } from '../ui/preferences.ts';
import { formFactor } from '../ui/formFactor.svelte.ts';

const LOOK_KEY = 'vibemusic.glass.look';
// Before on/off and the look were split, both lived in one entry under this key.
const COMBINED_KEY = 'vibemusic.glass';

type Look = { preset: string; params: GlassParams };

function splitCombined() {
	try {
		const combined = localStorage.getItem(COMBINED_KEY);
		if (combined === null) return;
		localStorage.removeItem(COMBINED_KEY);
		const stored = JSON.parse(combined) as { enabled?: boolean; preset?: string; params?: GlassParams } | null;
		if (!stored) return;
		writePreference('glass.enabled', stored.enabled ? 'on' : 'off');
		if (stored.params) localStorage.setItem(LOOK_KEY, JSON.stringify({ preset: stored.preset ?? '', params: stored.params }));
	} catch {
		return;
	}
}

// The instance's default look is a look name or a look code; anything else means the built-in one.
function defaultLook(): Look {
	const setting = instanceSetting('glass.look');
	const named = LOOKS.find((candidate) => candidate.id === setting);
	if (named) return { preset: named.id, params: { ...named.values } };
	if (setting)
		try {
			return lookFromCode(setting);
		} catch {
			// Not a valid code either.
		}
	return { preset: DEFAULT_LOOK.id, params: { ...DEFAULT_LOOK.values } };
}

function loadLook(): Look {
	try {
		const stored = JSON.parse(localStorage.getItem(LOOK_KEY) ?? 'null') as Partial<Look> | null;
		// Stored params are spread over BASE so parameters added in later versions get a default.
		if (stored?.params) return { preset: stored.preset ?? '', params: { ...BASE, ...stored.params } };
	} catch {
		localStorage.removeItem(LOOK_KEY);
	}
	return defaultLook();
}

function load() {
	splitCombined();
	return { enabled: readPreference('glass.enabled', ['on', 'off'] as const, 'off') === 'on', ...loadLook() };
}

export const glass = $state(load());

// Re-reads the settings once the instance defaults are known (routes/+layout.ts).
export function reloadGlass() {
	Object.assign(glass, load());
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

// Debounced so dragging a slider doesn't write localStorage on every step.
function saveLook() {
	clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		try {
			localStorage.setItem(LOOK_KEY, JSON.stringify({ preset: glass.preset, params: $state.snapshot(glass.params) }));
		} catch {
			return;
		}
	}, 200);
}

export const glassActive = () => glass.enabled && !formFactor.phone;

export function setGlassEnabled(enabled: boolean) {
	glass.enabled = enabled;
	writePreference('glass.enabled', enabled ? 'on' : 'off');
}

export function setGlassParam(key: keyof GlassParams, value: number) {
	glass.params[key] = value;
	// The look picker shows a preset only while the values still match it exactly; '' means custom.
	glass.preset =
		LOOKS.find((preset) =>
			Object.entries(preset.values).every(([name, target]) => Math.abs(glass.params[name as keyof GlassParams] - target) < 1e-6)
		)?.id ?? '';
	saveLook();
}

export function applyGlassPreset(id: string) {
	const preset = LOOKS.find((candidate) => candidate.id === id);
	if (!preset) return;
	glass.params = { ...preset.values };
	glass.preset = id;
	saveLook();
}

export function applyGlassParams(params: GlassParams, preset: string) {
	glass.params = { ...params };
	glass.preset = LOOKS.some(
		(candidate) =>
			candidate.id === preset &&
			Object.entries(candidate.values).every(([name, value]) => Math.abs(params[name as keyof GlassParams] - value) < 1e-6)
	)
		? preset
		: '';
	saveLook();
}

export function glassLookIsDefault() {
	const { params } = defaultLook();
	return (Object.keys(params) as GlassKey[]).every((key) => Math.abs(glass.params[key] - params[key]) < 1e-6);
}

// Forgets the visitor's look, so it follows the instance default again. On/off is left alone.
export function resetGlassLook() {
	clearTimeout(saveTimer);
	try {
		localStorage.removeItem(LOOK_KEY);
	} catch {
		// Storage unavailable: nothing was saved.
	}
	Object.assign(glass, defaultLook());
}
