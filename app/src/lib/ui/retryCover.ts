// Retries cover images that fail to load. Navidrome throttles cover generation and answers 429
// under load, so failures are often temporary.
import type { Attachment } from 'svelte/attachments';
import { COVER_RETRY } from '../tuning.ts';

export const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export const retryCover: Attachment<HTMLImageElement> = (image) => {
	let attempts = 0;
	let failed = '';
	let timer: ReturnType<typeof setTimeout> | undefined;
	// Swap in a transparent pixel right away so the browser never draws its broken-image frame
	// over the blurred placeholder, then put the real URL back after an exponential backoff
	// with jitter, so many failed covers don't all retry at the same moment.
	const retry = () => {
		if (image.src === TRANSPARENT_PIXEL) return;
		failed = image.src;
		image.src = TRANSPARENT_PIXEL;
		if (attempts >= COVER_RETRY.attempts) return;
		timer = setTimeout(
			() => {
				// Skip if the component has pointed the image at a different cover meanwhile.
				if (image.src === TRANSPARENT_PIXEL) image.src = failed;
			},
			COVER_RETRY.baseDelayMs * 2 ** attempts + Math.random() * COVER_RETRY.jitterMs
		);
		attempts += 1;
	};
	// The transparent pixel fires load too; it must not reset the backoff, or retries never slow down.
	const loaded = () => {
		if (image.src !== TRANSPARENT_PIXEL) attempts = 0;
	};
	image.addEventListener('error', retry);
	image.addEventListener('load', loaded);
	return () => {
		clearTimeout(timer);
		image.removeEventListener('error', retry);
		image.removeEventListener('load', loaded);
	};
};
