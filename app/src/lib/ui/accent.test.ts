import { expect, it } from 'vitest';
import { vividFromPalette } from './accent.ts';

it('turns a muted cover colour into a vivid one with the same hue', () => {
	expect(vividFromPalette(['#9a8a70', '#202020'])).toBe('rgb(237 173 69)');
	expect(vividFromPalette(['#7a3030'])).toBe('rgb(237 69 69)');
});

it('leaves grey covers to the default colour', () => {
	expect(vividFromPalette(['#808080', '#202020'])).toBeNull();
	expect(vividFromPalette([])).toBeNull();
});
