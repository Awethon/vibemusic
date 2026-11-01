import type { Attachment } from 'svelte/attachments';
import { COVER_RETRY } from '../tuning.ts';

export const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export const retryCover: Attachment<HTMLImageElement> = (image) => {
	let attempts = 0;
	let failed = '';
	let timer: ReturnType<typeof setTimeout> | undefined;
	const retry = () => {
		if (image.src === TRANSPARENT_PIXEL) return;
		failed = image.src;
		image.src = TRANSPARENT_PIXEL;
		if (attempts >= COVER_RETRY.attempts) return;
		timer = setTimeout(() => {
			if (image.src === TRANSPARENT_PIXEL) image.src = failed;
		}, COVER_RETRY.baseDelayMs * 2 ** attempts + Math.random() * COVER_RETRY.jitterMs);
		attempts += 1;
	};
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
