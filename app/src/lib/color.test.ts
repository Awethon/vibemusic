import { describe, expect, it } from 'vitest';
import { hexToRgb, hslToUnitRgb, relativeLuminance, rgbToHsl } from './color.ts';

describe('color', () => {
	it('parses hex colours', () => {
		expect(hexToRgb('#ff8000')).toEqual([255, 128, 0]);
	});

	it('converts to hsl with hue as a fraction of a turn', () => {
		expect(rgbToHsl([255, 0, 0])).toEqual([0, 1, 0.5]);
		const [hue, saturation, lightness] = rgbToHsl([0, 0, 255]);
		expect(hue).toBeCloseTo(2 / 3);
		expect(saturation).toBe(1);
		expect(lightness).toBe(0.5);
		expect(rgbToHsl([128, 128, 128])).toEqual([0, 0, 128 / 255]);
	});

	it('round-trips through hsl', () => {
		for (const hex of ['#5a2a7a', '#1a0a2a', '#8a2050', '#e0e0e0', '#10ff40']) {
			const rgb = hexToRgb(hex);
			const back = hslToUnitRgb(rgbToHsl(rgb)).map((channel) => Math.round(channel * 255));
			expect(back).toEqual(rgb);
		}
	});

	it('weights luminance towards green', () => {
		expect(relativeLuminance([0, 1, 0])).toBeGreaterThan(relativeLuminance([1, 0, 0]));
		expect(relativeLuminance([1, 1, 1])).toBeCloseTo(1);
	});
});
