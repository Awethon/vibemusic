import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COVER_RETRY } from '../tuning.ts';
import { retryCover } from './retryCover.ts';

class FakeImage extends EventTarget {
	loads = 0;
	#src = '';
	get src() {
		return this.#src;
	}
	set src(value: string) {
		this.#src = value;
		this.loads += 1;
	}
}

const longestDelay = (attempt: number) => COVER_RETRY.baseDelayMs * 2 ** attempt + COVER_RETRY.jitterMs;

describe('retryCover', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('reloads a failed cover a limited number of times', () => {
		const image = new FakeImage();
		image.src = '/rest/getCoverArt?id=al-1';
		retryCover(image as unknown as HTMLImageElement);
		for (let attempt = 0; attempt < COVER_RETRY.attempts + 2; attempt++) {
			image.dispatchEvent(new Event('error'));
			vi.advanceTimersByTime(longestDelay(attempt));
		}
		expect(image.loads).toBe(1 + COVER_RETRY.attempts);
	});

	it('starts counting again after a successful load', () => {
		const image = new FakeImage();
		image.src = '/rest/getCoverArt?id=al-1';
		retryCover(image as unknown as HTMLImageElement);
		image.dispatchEvent(new Event('error'));
		vi.advanceTimersByTime(longestDelay(0));
		image.dispatchEvent(new Event('load'));
		image.src = '/rest/getCoverArt?id=al-2';
		for (let attempt = 0; attempt < COVER_RETRY.attempts; attempt++) {
			image.dispatchEvent(new Event('error'));
			vi.advanceTimersByTime(longestDelay(attempt));
		}
		expect(image.loads).toBe(2 + 1 + COVER_RETRY.attempts);
	});

	it('leaves a cover alone once its source changed', () => {
		const image = new FakeImage();
		image.src = '/rest/getCoverArt?id=al-1';
		retryCover(image as unknown as HTMLImageElement);
		image.dispatchEvent(new Event('error'));
		image.src = '/rest/getCoverArt?id=al-2';
		vi.advanceTimersByTime(longestDelay(0));
		expect(image.loads).toBe(2);
	});
});
