import { BASE, DEFAULT_LOOK, LOOKS, type GlassParams } from './params.ts';
import { formFactor } from '../ui/formFactor.svelte.ts';

const STORAGE_KEY = 'vibemusic.glass';
const DEFAULT_PRESET = DEFAULT_LOOK;

type Stored = { enabled: boolean; preset: string; params: GlassParams };

function load(): Stored {
	try {
		const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Stored> | null;
		if (stored) return { enabled: !!stored.enabled, preset: stored.params ? (stored.preset ?? '') : DEFAULT_PRESET.id, params: { ...(stored.params ? BASE : DEFAULT_PRESET.values), ...stored.params } };
	} catch {
		localStorage.removeItem(STORAGE_KEY);
	}
	return { enabled: false, preset: DEFAULT_PRESET.id, params: { ...DEFAULT_PRESET.values } };
}

export const glass = $state(load());

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function save() {
	clearTimeout(saveTimer);
	saveTimer = setTimeout(() => localStorage.setItem(STORAGE_KEY, JSON.stringify($state.snapshot(glass))), 200);
}

export const glassActive = () => glass.enabled && !formFactor.phone;

export function setGlassEnabled(enabled: boolean) {
	glass.enabled = enabled;
	save();
}

export function setGlassParam(key: keyof GlassParams, value: number) {
	glass.params[key] = value;
	glass.preset = LOOKS.find((preset) => Object.entries(preset.values).every(([name, target]) => Math.abs(glass.params[name as keyof GlassParams] - target) < 1e-6))?.id ?? '';
	save();
}

export function applyGlassPreset(id: string) {
	const preset = LOOKS.find((candidate) => candidate.id === id);
	if (!preset) return;
	glass.params = { ...preset.values };
	glass.preset = id;
	save();
}

export function applyGlassParams(params: GlassParams, preset: string) {
	glass.params = { ...params };
	glass.preset = LOOKS.some((candidate) => candidate.id === preset && Object.entries(candidate.values).every(([name, value]) => Math.abs(params[name as keyof GlassParams] - value) < 1e-6)) ? preset : '';
	save();
}
