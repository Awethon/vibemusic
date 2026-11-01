import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readPreference, setPreferenceDefaults } from './preferences.ts';

const stored = new Map<string, string>();

beforeEach(() => {
	stored.clear();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => stored.get(key) ?? null,
		setItem: (key: string, value: string) => stored.set(key, value)
	});
	setPreferenceDefaults({});
});

describe('readPreference', () => {
	it('uses the instance default for a preference the visitor never set', () => {
		setPreferenceDefaults({ background: 'amber', sidebar: 'open' });
		expect(readPreference('background', ['field', 'amber'], 'field')).toBe('amber');
		expect(readPreference('rail', ['open', 'mini'], 'mini')).toBe('open');
	});

	it('keeps the visitor’s own choice over the instance default', () => {
		stored.set('vibemusic.background', 'field');
		setPreferenceDefaults({ background: 'amber' });
		expect(readPreference('background', ['field', 'amber'], 'field')).toBe('field');
	});

	it('ignores an instance default that is not an allowed value', () => {
		setPreferenceDefaults({ ripples: 'yes' });
		expect(readPreference('ripples', ['on', 'off'], 'off')).toBe('off');
	});
});
