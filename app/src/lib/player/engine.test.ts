import { describe, expect, it, vi } from 'vitest';
import { AudioEngine, type PlaybackFailure } from './engine.ts';

// Just enough of an <audio> element for the engine: it records what was asked of it.
class FakeAudio extends EventTarget {
	static created: FakeAudio[] = [];
	src = '';
	preload = '';
	paused = true;
	ended = false;
	currentTime = 0;
	duration = Number.NaN;
	readyState = 0;
	volume = 1;
	error: { code: number; message: string } | null = null;
	loads = 0;

	constructor() {
		super();
		FakeAudio.created.push(this);
	}

	load() {
		this.loads += 1;
		this.error = null;
	}

	pause() {
		this.paused = true;
	}

	removeAttribute(name: string) {
		if (name === 'src') this.src = '';
	}

	fail(code: number) {
		this.error = { code, message: 'broken' };
		this.dispatchEvent(new Event('error'));
	}
}

const NETWORK = 2;
const NOT_SUPPORTED = 4;

vi.stubGlobal('Audio', FakeAudio);
vi.stubGlobal('MediaError', { MEDIA_ERR_NETWORK: NETWORK });
vi.stubGlobal('HTMLMediaElement', { HAVE_METADATA: 1, HAVE_FUTURE_DATA: 3 });

function createEngine() {
	FakeAudio.created = [];
	const failures: PlaybackFailure[] = [];
	const engine = new AudioEngine({ ended: () => {}, failed: (failure) => failures.push(failure), changed: () => {} });
	const [first, second] = FakeAudio.created;
	return { engine, failures, first, second };
}

describe('AudioEngine', () => {
	it('swaps to the standby deck when the next track was preloaded', async () => {
		const { engine, first, second } = createEngine();
		await engine.load('a', '/a', { autoplay: false });
		engine.prepare('b', '/b');
		await engine.load('b', '/b', { autoplay: false });
		expect(engine.trackId).toBe('b');
		expect(second.src).toBe('/b');
		expect(first.src).toBe('');
	});

	it('loads the next track afresh when its preload failed, instead of swapping to the dead deck', async () => {
		const { engine, failures, first, second } = createEngine();
		await engine.load('a', '/a', { autoplay: false });
		engine.prepare('b', '/b');
		second.fail(NETWORK);
		expect(failures).toEqual([]);
		await engine.load('b', '/b', { autoplay: false });
		expect(engine.trackId).toBe('b');
		expect(first.src).toBe('/b');
		expect(engine.failed).toBe(false);
	});

	it('preloads the same track again after a failed preload', async () => {
		const { engine, second } = createEngine();
		await engine.load('a', '/a', { autoplay: false });
		engine.prepare('b', '/b');
		engine.prepare('b', '/b');
		expect(second.loads).toBe(1);
		second.fail(NETWORK);
		engine.prepare('b', '/b');
		expect(second.loads).toBe(2);
	});

	it('reports whether the connection dropped and whether the track was playing', async () => {
		const { engine, failures, first } = createEngine();
		await engine.load('a', '/a', { autoplay: false });
		first.paused = false;
		first.fail(NETWORK);
		first.paused = true;
		first.fail(NOT_SUPPORTED);
		expect(failures).toEqual([
			{ message: 'broken', network: true, playing: true },
			{ message: 'broken', network: false, playing: false }
		]);
		expect(engine.failed).toBe(true);
	});
});
