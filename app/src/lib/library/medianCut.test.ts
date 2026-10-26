import { describe, expect, it } from 'vitest';
import { medianCut } from './medianCut.ts';

const image = (colors: [number, number, number, number][]) => {
	const pixels: number[] = [];
	for (const [red, green, blue, count] of colors) for (let index = 0; index < count; index++) pixels.push(red, green, blue, 255);
	return new Uint8ClampedArray(pixels);
};

describe('medianCut', () => {
	it('separates distinct colours', () => {
		expect(medianCut(image([[255, 0, 0, 20], [0, 0, 255, 20]]), 2).toSorted()).toEqual(['#0000ff', '#ff0000']);
	});


	it('returns fewer colours for a flat image', () => {
		expect(medianCut(image([[10, 20, 30, 50]]))).toEqual(['#0a141e']);
	});
});
