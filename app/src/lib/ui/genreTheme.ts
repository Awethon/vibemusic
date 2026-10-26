type Rgb = [number, number, number];

const parse = (hex: string): Rgb => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as Rgb;

function toHsl([red, green, blue]: Rgb): [number, number, number] {
	const [r, g, b] = [red / 255, green / 255, blue / 255];
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const lightness = (max + min) / 2;
	if (max === min) return [0, 0, lightness];
	const delta = max - min;
	const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
	const hue = max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
	return [hue * 60, saturation, lightness];
}

const colourfulness = (rgb: Rgb) => {
	const [, saturation, lightness] = toHsl(rgb);
	return saturation * (1 - Math.abs(lightness - 0.5) * 1.6);
};

const hsl = (hue: number, saturation: number, lightness: number, alpha = 1) =>
	`hsl(${hue.toFixed(1)} ${(saturation * 100).toFixed(1)}% ${(lightness * 100).toFixed(1)}% / ${alpha})`;

export function genreTheme(colors: string[]) {
	if (!colors.length) return { accent: 'hsl(260 40% 80%)', deep: 'hsl(260 12% 7%)', deepAlpha: 'hsl(260 12% 7% / 0.7)' };
	const best = colors.map(parse).reduce((winner, candidate) => (colourfulness(candidate) > colourfulness(winner) ? candidate : winner));
	const [hue, saturation] = toHsl(best);
	const vivid = Math.max(0.45, Math.min(0.9, saturation));
	const deep = Math.min(0.5, vivid);
	return { accent: hsl(hue, vivid, 0.68), deep: hsl(hue, deep, 0.08), deepAlpha: hsl(hue, deep, 0.08, 0.7) };
}
