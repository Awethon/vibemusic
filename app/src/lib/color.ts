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

// OKLab: [lightness 0..1, a, b]. A perceptual space where averaging and distances behave like the
// eye expects, used for palette extraction and the caustics background.
export type Oklab = [number, number, number];

const toLinear = (channel: number) => ((channel /= 255) <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
const fromLinear = (channel: number) => 255 * (channel <= 0.0031308 ? channel * 12.92 : 1.055 * Math.max(0, channel) ** (1 / 2.4) - 0.055);

export function linearToOklab([r, g, b]: [number, number, number]): Oklab {
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
	];
}

export function oklabToLinear([L, a, b]: Oklab): [number, number, number] {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
	];
}

export const rgbToOklab = (rgb: Rgb): Oklab => linearToOklab(rgb.map(toLinear) as [number, number, number]);

export const oklabToHex = (lab: Oklab) =>
	'#' +
	oklabToLinear(lab)
		.map((channel) =>
			Math.round(Math.min(255, Math.max(0, fromLinear(channel))))
				.toString(16)
				.padStart(2, '0')
		)
		.join('');

export const chroma = ([, a, b]: Oklab) => Math.hypot(a, b);
