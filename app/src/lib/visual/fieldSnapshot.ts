const SNAPSHOT_WIDTH = 192;
const SNAPSHOT_INTERVAL_MS = 100;

let context: CanvasRenderingContext2D | null = null;
let lastCopy = 0;

export const fieldSnapshot = { version: 0, canvas: null as HTMLCanvasElement | null };

export function copyField(source: HTMLCanvasElement, now: number) {
	if (now - lastCopy < SNAPSHOT_INTERVAL_MS || !source.width || !source.height) return;
	lastCopy = now;
	context ??= document.createElement('canvas').getContext('2d');
	if (!context) return;
	const height = Math.max(1, Math.round((SNAPSHOT_WIDTH * source.height) / source.width));
	if (context.canvas.width !== SNAPSHOT_WIDTH || context.canvas.height !== height) {
		context.canvas.width = SNAPSHOT_WIDTH;
		context.canvas.height = height;
	}
	try {
		context.drawImage(source, 0, 0, SNAPSHOT_WIDTH, height);
	} catch {
		return;
	}
	fieldSnapshot.canvas = context.canvas;
	fieldSnapshot.version += 1;
}
