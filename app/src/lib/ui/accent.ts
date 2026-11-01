// The UI accent colour (--accent) and favicon colour, both taken from the playing album's palette.
import { hexToRgb, hslToUnitRgb, rgbToHsl, type Rgb } from '../color.ts';
import { ACCENT } from '../tuning.ts';

function colourfulness([red, green, blue]: Rgb) {
	const max = Math.max(red, green, blue) / 255;
	const min = Math.min(red, green, blue) / 255;
	return (max - min) * (1 - Math.abs(max + min - 1) * 0.5);
}

const mostColourful = (colors: string[]) =>
	colors.map(hexToRgb).reduce((winner, candidate) => (colourfulness(candidate) > colourfulness(winner) ? candidate : winner));

export function accentFromPalette(colors: string[]): Rgb | null {
	if (!colors.length) return null;
	// Brighten to a fixed level, then mix towards white, so even a dark album gives an accent
	// that reads on the dark UI.
	const best = mostColourful(colors);
	const scale = ACCENT.brightestChannel / Math.max(1, ...best);
	return best.map((channel) => Math.min(255, channel * scale * ACCENT.colourWeight + 255 * ACCENT.whiteWeight * ACCENT.whiteLevel)) as Rgb;
}

export function vividFromPalette(colors: string[]): string | null {
	if (!colors.length) return null;
	const [hue, saturation] = rgbToHsl(mostColourful(colors));
	if (saturation < ACCENT.vividMinSaturation) return null;
	return `rgb(${hslToUnitRgb([hue, ACCENT.vividSaturation, ACCENT.vividLightness])
		.map((channel) => Math.round(channel * 255))
		.join(' ')})`;
}

// One step of an exponential ease towards target, run every frame. Snapping when close lets the
// caller detect "no change" and stop writing --accent; a pure ease would never quite arrive.
export function blendAccent(current: Rgb, target: Rgb, blend: number): Rgb {
	return current.map((channel, index) => {
		const next = channel + (target[index] - channel) * blend;
		return Math.abs(target[index] - next) < ACCENT.snapDistance ? target[index] : next;
	}) as Rgb;
}
