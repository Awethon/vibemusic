// Accent and dark background colours for a generated genre cover, from the hue of the most
// colourful album colour. Saturation is clamped so dull palettes still look intentional.
import { hexToRgb, rgbToHsl, type Rgb } from '../color.ts';
import { GENRE_COVER } from '../tuning.ts';

const colourfulness = (rgb: Rgb) => {
	const [, saturation, lightness] = rgbToHsl(rgb);
	return saturation * (1 - Math.abs(lightness - 0.5) * GENRE_COVER.offMidLightnessPenalty);
};

const hsl = (hue: number, saturation: number, lightness: number) =>
	`hsl(${hue.toFixed(1)} ${(saturation * 100).toFixed(1)}% ${(lightness * 100).toFixed(1)}%)`;

export function genreTheme(colors: string[]) {
	if (!colors.length) return { accent: 'hsl(260 40% 80%)', deep: 'hsl(260 12% 7%)' };
	const best = colors.map(hexToRgb).reduce((winner, candidate) => (colourfulness(candidate) > colourfulness(winner) ? candidate : winner));
	const [hue, saturation] = rgbToHsl(best);
	const degrees = hue * 360;
	const vivid = Math.max(GENRE_COVER.minSaturation, Math.min(GENRE_COVER.maxSaturation, saturation));
	const deep = Math.min(GENRE_COVER.maxDeepSaturation, vivid);
	return {
		accent: hsl(degrees, vivid, GENRE_COVER.accentLightness),
		deep: hsl(degrees, deep, GENRE_COVER.deepLightness)
	};
}
