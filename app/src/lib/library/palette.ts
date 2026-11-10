import { coverUrl } from '../navidrome/credentials.ts';
import { requireCredentials } from '../session.svelte.ts';
import { patchLibrary } from './library.svelte.ts';
import { coverPalette } from './coverPalette.ts';
import PaletteWorker from './palette.worker.ts?worker';
import { coverPixels, type PaletteResponse } from './paletteExtract.ts';
import { PALETTE_KEY_SUFFIX, savedPalette } from './queries.ts';
import { COVER_PX } from '../tuning.ts';

let worker: Worker | null | undefined;
let nextRequest = 0;
const waiting = new Map<number, { resolve: (colors: string[]) => void; reject: (error: Error) => void }>();

// One worker for all extractions; null when workers can't start, and extraction runs here instead.
function paletteWorker(): Worker | null {
	if (worker !== undefined) return worker;
	try {
		worker = new PaletteWorker();
		worker.addEventListener('message', (event: MessageEvent<PaletteResponse>) => {
			const response = event.data;
			const request = waiting.get(response.id);
			waiting.delete(response.id);
			if ('colors' in response) request?.resolve(response.colors);
			else request?.reject(new Error(response.error));
		});
	} catch {
		worker = null;
	}
	return worker;
}

async function extract(albumId: string): Promise<string[]> {
	const url = coverUrl(requireCredentials(), albumId, COVER_PX.paletteSample);
	const target = paletteWorker();
	if (!target) return coverPalette(await coverPixels(url));
	const id = ++nextRequest;
	return new Promise((resolve, reject) => {
		waiting.set(id, { resolve, reject });
		target.postMessage({ id, url });
	});
}

const inFlight = new Map<string, Promise<string[]>>();

/**
 * Dominant colours of an album cover, most common first. Computed once in the browser and stored
 * in the library's palette table (shared with other tabs, kept across rebuilds).
 */
export function albumPalette(albumId: string): Promise<string[]> {
	const existing = inFlight.get(albumId);
	if (existing) return existing;
	const loading = (async () => {
		const saved = await savedPalette(albumId);
		if (saved) return saved;
		const colors = await extract(albumId);
		if (colors.length)
			await patchLibrary('palette', 'insert or replace into palette values (?, ?)', [albumId + PALETTE_KEY_SUFFIX, JSON.stringify(colors)]);
		return colors;
	})();
	inFlight.set(albumId, loading);
	loading.catch(() => inFlight.delete(albumId));
	return loading;
}
