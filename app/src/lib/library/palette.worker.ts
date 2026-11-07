// Cover palette extraction off the main thread: decoding the cover and the k-means in
// coverPalette.ts take long enough to drop frames when a page opens.
import { coverPixels, type PaletteRequest, type PaletteResponse } from './paletteExtract.ts';
import { coverPalette } from './coverPalette.ts';

self.addEventListener('message', async (event: MessageEvent<PaletteRequest>) => {
	const { id, url } = event.data;
	let response: PaletteResponse;
	try {
		response = { id, colors: coverPalette(await coverPixels(url)) };
	} catch (error) {
		response = { id, error: String(error) };
	}
	self.postMessage(response);
});
