// A stand-in for the audio engine in tests of the code around it (playback, remote control).
import type { EngineListener, PlaybackFailure, StartResult } from './engine.ts';

type Load = { trackId: string; autoplay: boolean; startAt: number };

// Like the real engine, a track that was told to play counts as playing at once but is buffering
// until audio arrives (`started`).
export class FakeEngine {
	// The engine the code under test created most recently.
	static latest: FakeEngine;
	trackId = '';
	playing = false;
	buffering = false;
	position = 0;
	duration = 0;
	failed = false;
	live = false;
	loads: Load[] = [];
	prepared: (string | null)[] = [];
	stops = 0;
	// Set by a test to keep the next load from finishing until it says so.
	hold: Promise<StartResult> | null = null;

	constructor(public listener: EngineListener) {
		FakeEngine.latest = this;
	}

	async load(trackId: string, _url: string, options: { autoplay: boolean; startAt?: number }): Promise<StartResult> {
		this.trackId = trackId;
		this.failed = false;
		this.position = options.startAt ?? 0;
		this.playing = this.buffering = options.autoplay;
		this.loads.push({ trackId, autoplay: options.autoplay, startAt: options.startAt ?? 0 });
		const hold = this.hold;
		this.hold = null;
		return hold ?? (options.autoplay ? 'playing' : 'stopped');
	}

	started() {
		this.buffering = false;
		this.listener.changed();
	}

	fail(failure: Partial<PlaybackFailure> = {}) {
		this.failed = true;
		const playing = failure.playing ?? this.playing;
		this.playing = this.buffering = false;
		this.listener.failed({ message: 'broken', network: false, playing, ...failure });
	}

	prepare(trackId: string | null) {
		this.prepared.push(trackId);
	}

	async resume(): Promise<StartResult> {
		this.playing = true;
		return 'playing';
	}

	seek(seconds: number) {
		this.position = seconds;
	}

	pause() {
		this.playing = this.buffering = false;
	}

	stop() {
		this.stops += 1;
		this.pause();
		this.position = 0;
	}

	setLevel() {}

	wake() {}
}
