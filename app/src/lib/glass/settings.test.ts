import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeLookCode, LOOKS } from './params.ts';

vi.mock('../ui/formFactor.svelte.ts', () => ({ formFactor: { phone: false } }));

const stored = new Map<string, string>();

async function loadSettings(defaults: Record<string, string> = {}) {
	vi.resetModules();
	const preferences = await import('../ui/preferences.ts');
	preferences.setPreferenceDefaults(defaults);
	return import('./settings.svelte.ts');
}

beforeEach(() => {
	stored.clear();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => stored.get(key) ?? null,
		setItem: (key: string, value: string) => stored.set(key, value),
		removeItem: (key: string) => stored.delete(key)
	});
});

describe('glass settings', () => {
	it('splits the old combined entry into on/off and the look', async () => {
		const prism = LOOKS.find((look) => look.id === 'prism')!;
		stored.set('vibemusic.glass', JSON.stringify({ enabled: true, preset: 'prism', params: prism.values }));
		const { glass } = await loadSettings();
		expect(glass.enabled).toBe(true);
		expect(glass.preset).toBe('prism');
		expect(stored.has('vibemusic.glass')).toBe(false);
		expect(stored.get('vibemusic.glass.enabled')).toBe('on');
	});

	it('follows the instance default look after turning glass on', async () => {
		const { glass, setGlassEnabled } = await loadSettings({ glassLook: 'frosted' });
		setGlassEnabled(true);
		expect(glass.preset).toBe('frosted');
		expect(stored.has('vibemusic.glass.look')).toBe(false);
	});

	it('resets a tuned look to the instance default and keeps glass on', async () => {
		stored.set('vibemusic.glass.enabled', 'on');
		stored.set('vibemusic.glass.look', JSON.stringify({ preset: 'slab', params: LOOKS.find((look) => look.id === 'slab')!.values }));
		const { glass, glassLookIsDefault, resetGlassLook } = await loadSettings({ glassLook: 'bubble' });
		expect(glassLookIsDefault()).toBe(false);
		resetGlassLook();
		expect(glass.preset).toBe('bubble');
		expect(glass.enabled).toBe(true);
		expect(glassLookIsDefault()).toBe(true);
		expect(stored.has('vibemusic.glass.look')).toBe(false);
	});

	it('takes a look code as the instance default look', async () => {
		const tuned = { ...LOOKS[0].values, thick: 63, ior: 2.07 };
		const { glass, glassLookIsDefault } = await loadSettings({ glassLook: encodeLookCode(tuned) });
		expect(glass.params.thick).toBe(63);
		expect(glass.params.ior).toBeCloseTo(2.07, 6);
		expect(glass.preset).toBe('');
		expect(glassLookIsDefault()).toBe(true);
	});

	it('falls back to the built-in look for a default that is neither a look nor a code', async () => {
		const { glass } = await loadSettings({ glassLook: 'sparkly' });
		expect(glass.preset).toBe('default');
	});
});
