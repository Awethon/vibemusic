import { describe, expect, it } from 'vitest';
import { hexToRgb, rgbToOklab } from '../color.ts';
import { coverPalette, unmud } from './coverPalette.ts';

const image = (colors: [number, number, number, number][]) => {
	const pixels: number[] = [];
	for (const [red, green, blue, count] of colors) for (let index = 0; index < count; index++) pixels.push(red, green, blue, 255);
	return new Uint8ClampedArray(pixels);
};

const near = (hex: string, rgb: [number, number, number]) => hexToRgb(hex).every((channel, i) => Math.abs(channel - rgb[i]) <= 3);

describe('coverPalette', () => {
	it('separates distinct colours', () => {
		const palette = coverPalette(
			image([
				[220, 30, 30, 500],
				[30, 60, 200, 500]
			])
		);
		expect(palette).toHaveLength(2);
		expect(palette.some((hex) => near(hex, [220, 30, 30]))).toBe(true);
		expect(palette.some((hex) => near(hex, [30, 60, 200]))).toBe(true);
	});

	it('returns one colour for a flat image', () => {
		expect(coverPalette(image([[10, 20, 30, 500]]))).toEqual(['#0a141e']);
	});

	it('keeps a small vivid accent on a grey cover', () => {
		const palette = coverPalette(
			image([
				[150, 140, 145, 600],
				[110, 100, 105, 300],
				[190, 185, 190, 300],
				[185, 55, 55, 12]
			])
		);
		expect(palette.some((hex) => near(hex, [185, 55, 55]))).toBe(true);
	});

	it('skips the greys between black and white', () => {
		const ramp: [number, number, number, number][] = [
			[245, 245, 245, 600],
			[8, 8, 8, 200]
		];
		for (let level = 40; level < 240; level += 20) ramp.push([level, level, level, 25]);
		const palette = coverPalette(image(ramp));
		expect(palette).toHaveLength(2);
	});

	it('keeps the white even when a vivid accent is just as light', () => {
		const palette = coverPalette(
			image([
				[0, 0, 0, 600],
				[239, 237, 236, 200],
				[250, 243, 147, 60]
			])
		);
		expect(palette.some((hex) => near(hex, [239, 237, 236]))).toBe(true);
		expect(palette.some((hex) => near(hex, [250, 243, 147]))).toBe(true);
	});
});

describe('unmud', () => {
	it('moves a mid yellow-brown toward an end and turns it slightly red', () => {
		const brown = rgbToOklab(hexToRgb('#695b4e'));
		const result = unmud(brown);
		expect(Math.abs(result[0] - brown[0])).toBeGreaterThan(0.02);
		expect(Math.atan2(result[2], result[1])).toBeLessThan(Math.atan2(brown[2], brown[1]));
	});

	it('leaves vivid, grey, dark and light colours alone', () => {
		for (const hex of ['#fb3356', '#808080', '#0e0e0d', '#fdfbf3']) {
			const lab = rgbToOklab(hexToRgb(hex));
			expect(unmud(lab)).toEqual(lab);
		}
	});
});
