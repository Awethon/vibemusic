import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COVER_RETRY } from '../tuning.ts';
import { retryCover, TRANSPARENT_PIXEL } from './retryCover.ts';

class FakeImage extends EventTarget {
	assigned: string[] = [];
	#src = '';
	get src() {
		return this.#src;
	}
	set src(value: string) {
		this.#src = value;
		this.assigned.push(value);
	}
}

const COVER = '/rest/getCoverArt?id=al-1';
const longestDelay = (attempt: number) => COVER_RETRY.baseDelayMs * 2 ** attempt + COVER_RETRY.jitterMs;
const realLoads = (image: FakeImage, source = COVER) => image.assigned.filter((value) => value === source).length;

function attached(source = COVER) {
	const image = new FakeImage();
	image.src = source;
	retryCover(image as unknown as HTMLImageElement);
	return image;
}

describe('retryCover', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('hides a failed cover behind a transparent pixel, then reloads it a limited number of times', () => {
		const image = attached();
		for (let attempt = 0; attempt < COVER_RETRY.attempts + 2; attempt++) {
			image.dispatchEvent(new Event('error'));
			expect(image.src).toBe(TRANSPARENT_PIXEL);
			vi.advanceTimersByTime(longestDelay(attempt));
		}
		expect(realLoads(image)).toBe(1 + COVER_RETRY.attempts);
		expect(image.src).toBe(TRANSPARENT_PIXEL);
	});

	it('does not count the transparent pixel loading as a success', () => {
		const image = attached();
		for (let attempt = 0; attempt < COVER_RETRY.attempts + 2; attempt++) {
			image.dispatchEvent(new Event('error'));
			image.dispatchEvent(new Event('load'));
			vi.advanceTimersByTime(longestDelay(attempt));
		}
		expect(realLoads(image)).toBe(1 + COVER_RETRY.attempts);
	});

	it('starts counting again after a real load', () => {
		const image = attached();
		image.dispatchEvent(new Event('error'));
		vi.advanceTimersByTime(longestDelay(0));
		image.dispatchEvent(new Event('load'));
		image.src = '/rest/getCoverArt?id=al-2';
		for (let attempt = 0; attempt < COVER_RETRY.attempts; attempt++) {
			image.dispatchEvent(new Event('error'));
			vi.advanceTimersByTime(longestDelay(attempt));
		}
		expect(realLoads(image, '/rest/getCoverArt?id=al-2')).toBe(1 + COVER_RETRY.attempts);
	});

	it('leaves a cover alone once its source changed', () => {
		const image = attached();
		image.dispatchEvent(new Event('error'));
		image.src = '/rest/getCoverArt?id=al-2';
		vi.advanceTimersByTime(longestDelay(0));
		expect(image.src).toBe('/rest/getCoverArt?id=al-2');
		expect(realLoads(image)).toBe(1);
	});
});
