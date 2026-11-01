// Small colour-space helpers shared by the accent colour and the animated background.
// Hsl components are all 0..1; Rgb is 0..255; "unit" RGB is 0..1.

export type Rgb = [number, number, number];

export type Hsl = [number, number, number];

export const hexToRgb = (hex: string): Rgb => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as Rgb;

export function rgbToHsl([red, green, blue]: Rgb): Hsl {
	const [r, g, b] = [red / 255, green / 255, blue / 255];
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const lightness = (max + min) / 2;
	const delta = max - min;
	if (!delta) return [0, 0, lightness];
	const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
	const sector = max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
	return [sector / 6, saturation, lightness];
}

function hueToChannel(p: number, q: number, t: number): number {
	if (t < 0) t += 1;
	if (t > 1) t -= 1;
	if (t < 1 / 6) return p + (q - p) * 6 * t;
	if (t < 1 / 2) return q;
	if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
	return p;
}

export function hslToUnitRgb([hue, saturation, lightness]: Hsl): [number, number, number] {
	const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
	const p = 2 * lightness - q;
	return [hueToChannel(p, q, hue + 1 / 3), hueToChannel(p, q, hue), hueToChannel(p, q, hue - 1 / 3)];
}

// Rec. 709 weights applied directly to the given channels, without sRGB linearisation.
export const relativeLuminance = ([red, green, blue]: [number, number, number]) => 0.2126 * red + 0.7152 * green + 0.0722 * blue;
