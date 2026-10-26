import { ACCENT } from '../tuning.ts';

type Rgb = [number, number, number];

const parse = (hex: string): Rgb => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as Rgb;

function colourfulness([red, green, blue]: Rgb) {
	const max = Math.max(red, green, blue) / 255;
	const min = Math.min(red, green, blue) / 255;
	return (max - min) * (1 - Math.abs(max + min - 1) * 0.5);
}

export function accentFromPalette(colors: string[]): Rgb | null {
	if (!colors.length) return null;
	const rgb = colors.map(parse);
	const best = rgb.reduce((winner, candidate) => (colourfulness(candidate) > colourfulness(winner) ? candidate : winner));
	const scale = ACCENT.brightestChannel / Math.max(1, ...best);
	return best.map((channel) => Math.min(255, channel * scale * ACCENT.colourWeight + 255 * ACCENT.whiteWeight * ACCENT.whiteLevel)) as Rgb;
}

export function blendAccent(current: Rgb, target: Rgb, blend: number): Rgb {
	return current.map((channel, index) => {
		const next = channel + (target[index] - channel) * blend;
		return Math.abs(target[index] - next) < ACCENT.snapDistance ? target[index] : next;
	}) as Rgb;
}

export type { Rgb };
