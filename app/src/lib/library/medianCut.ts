import { PALETTE } from '../tuning.ts';

type Box = { pixels: number[][] };

const channelRange = (box: Box, channel: number) => {
	let low = 255;
	let high = 0;
	for (const pixel of box.pixels) {
		low = Math.min(low, pixel[channel]);
		high = Math.max(high, pixel[channel]);
	}
	return high - low;
};

const widestChannel = (box: Box) =>
	[0, 1, 2].reduce((best, channel) => (channelRange(box, channel) > channelRange(box, best) ? channel : best), 0);

const hex = (value: number) => Math.round(value).toString(16).padStart(2, '0');

// Classic median cut: repeatedly split the most populous box along its widest channel at the
// median. Returns hex colours ordered by how many pixels each box holds.
export function medianCut(rgba: Uint8ClampedArray, count: number = PALETTE.coverColors): string[] {
	const pixels: number[][] = [];
	for (let offset = 0; offset < rgba.length; offset += 4) pixels.push([rgba[offset], rgba[offset + 1], rgba[offset + 2]]);
	if (!pixels.length) return [];
	const boxes: Box[] = [{ pixels }];
	while (boxes.length < count) {
		const splittable = boxes.filter((box) => box.pixels.length > 1 && channelRange(box, widestChannel(box)) > 0);
		if (!splittable.length) break;
		const box = splittable.reduce((largest, candidate) => (candidate.pixels.length > largest.pixels.length ? candidate : largest));
		const channel = widestChannel(box);
		const sorted = box.pixels.toSorted((a, b) => a[channel] - b[channel]);
		const middle = sorted.length >> 1;
		boxes.splice(boxes.indexOf(box), 1, { pixels: sorted.slice(0, middle) }, { pixels: sorted.slice(middle) });
	}
	return boxes
		.toSorted((a, b) => b.pixels.length - a.pixels.length)
		.map((box) => {
			const average = [0, 1, 2].map((channel) => box.pixels.reduce((total, pixel) => total + pixel[channel], 0) / box.pixels.length);
			return `#${average.map(hex).join('')}`;
		});
}
