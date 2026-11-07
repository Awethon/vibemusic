// Shared by palette.ts and palette.worker.ts: a cover's pixels at palette sample size.
import { PALETTE } from '../tuning.ts';

export type PaletteRequest = { id: number; url: string };
export type PaletteResponse = { id: number; colors: string[] } | { id: number; error: string };

// Scaled with drawImage rather than createImageBitmap's resize options, which not every browser
// honours (an unscaled bitmap would leave only its top-left corner on the canvas).
export async function coverPixels(url: string): Promise<Uint8ClampedArray> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`cover ${response.status}`);
	const bitmap = await createImageBitmap(await response.blob());
	const size = PALETTE.coverSamplePx;
	const canvas = new OffscreenCanvas(size, size);
	const context = canvas.getContext('2d')!;
	context.drawImage(bitmap, 0, 0, size, size);
	bitmap.close();
	return context.getImageData(0, 0, size, size).data;
}
