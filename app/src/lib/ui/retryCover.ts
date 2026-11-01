import type { Attachment } from 'svelte/attachments';
import { COVER_RETRY } from '../tuning.ts';

export const retryCover: Attachment<HTMLImageElement> = (image) => {
	let attempts = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const retry = () => {
		if (attempts >= COVER_RETRY.attempts) return;
		const source = image.src;
		timer = setTimeout(() => {
			if (image.src === source) image.src = source;
		}, COVER_RETRY.baseDelayMs * 2 ** attempts + Math.random() * COVER_RETRY.jitterMs);
		attempts += 1;
	};
	const loaded = () => (attempts = 0);
	image.addEventListener('error', retry);
	image.addEventListener('load', loaded);
	return () => {
		clearTimeout(timer);
		image.removeEventListener('error', retry);
		image.removeEventListener('load', loaded);
	};
};
