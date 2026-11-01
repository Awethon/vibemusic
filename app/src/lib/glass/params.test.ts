import { describe, expect, it } from 'vitest';
import { BASE, decodeLabLink, encodeLookCode, LOOKS, lookFromCode } from './params.ts';

describe('look codes', () => {
	it('round-trips every look and keeps its name', () => {
		for (const look of LOOKS) {
			const code = encodeLookCode(look.values);
			expect(lookFromCode(code)).toEqual({ params: look.values, preset: look.id });
		}
	});

	it('round-trips hand-tuned values', () => {
		const tuned = { ...LOOKS[0].values, thick: 63, curve: 4.7, cut: -0.42, ior: 2.07, disp: 0.215, light: -133, frost: 12.5, flip: -1 };
		const { params, preset } = lookFromCode(encodeLookCode(tuned));
		for (const [key, value] of Object.entries(tuned)) expect(params[key as keyof typeof params]).toBeCloseTo(value, 6);
		expect(preset).toBe('');
	});

	it('starts from the closest lab preset, so a preset alone is a short code', () => {
		expect(encodeLookCode(LOOKS.find((look) => look.id === 'pebble')!.values)).toHaveLength(6);
	});

	it('writes URL-safe codes without padding, which also read as lab links', () => {
		const code = encodeLookCode({ ...BASE, thick: 90, light: 180 });
		expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(decodeLabLink(`https://example.com/lab/#${code}`).params.thick).toBe(90);
	});
});
