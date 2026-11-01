// A small, throttled copy of the background canvas for the liquid-glass layer, which draws it
// behind glass panels. Copying the full-size GPU canvas every frame would be too costly.

import { FIELD } from '../tuning.ts';

let context: CanvasRenderingContext2D | null = null;
let lastCopy = 0;

export const fieldSnapshot = { version: 0, canvas: null as HTMLCanvasElement | null };

export function copyField(source: HTMLCanvasElement, now: number) {
	if (now - lastCopy < FIELD.snapshotIntervalMs || !source.width || !source.height) return;
	lastCopy = now;
	context ??= document.createElement('canvas').getContext('2d');
	if (!context) return;
	const height = Math.max(1, Math.round((FIELD.snapshotWidthPx * source.height) / source.width));
	if (context.canvas.width !== FIELD.snapshotWidthPx || context.canvas.height !== height) {
		context.canvas.width = FIELD.snapshotWidthPx;
		context.canvas.height = height;
	}
	try {
		context.drawImage(source, 0, 0, FIELD.snapshotWidthPx, height);
	} catch {
		return;
	}
	fieldSnapshot.canvas = context.canvas;
	fieldSnapshot.version += 1;
}
