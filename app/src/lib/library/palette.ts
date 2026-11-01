import { coverUrl } from '../navidrome/credentials.ts';
import { requireCredentials } from '../session.svelte.ts';
import { patchLibrary } from './library.svelte.ts';
import { medianCut } from './medianCut.ts';
import { savedPalette } from './queries.ts';
import { COVER_PX, PALETTE } from '../tuning.ts';

// Downscales the cover to a tiny bitmap before median cut; a few thousand pixels are plenty for a palette.
async function extract(albumId: string): Promise<string[]> {
	const response = await fetch(coverUrl(requireCredentials(), albumId, COVER_PX.paletteSample));
	const bitmap = await createImageBitmap(await response.blob(), {
		resizeWidth: PALETTE.coverSamplePx,
		resizeHeight: PALETTE.coverSamplePx
	});
	const canvas = new OffscreenCanvas(PALETTE.coverSamplePx, PALETTE.coverSamplePx);
	const context = canvas.getContext('2d')!;
	context.drawImage(bitmap, 0, 0);
	bitmap.close();
	return medianCut(context.getImageData(0, 0, PALETTE.coverSamplePx, PALETTE.coverSamplePx).data);
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
		if (colors.length) await patchLibrary('insert or replace into palette values (?, ?)', [albumId, JSON.stringify(colors)]);
		return colors;
	})();
	inFlight.set(albumId, loading);
	loading.catch(() => inFlight.delete(albumId));
	return loading;
}
