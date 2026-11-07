// The audio engine: plays tracks and reports state; it knows nothing about the queue or the UI.
// Two <audio> elements ("decks") take turns so the next track can preload on the standby deck
// for gapless playback. Both feed one Web Audio graph (input -> delay -> output) that the
// visual analysis taps before the delay.

import { PLAYBACK } from '../tuning.ts';
import { createAnalysis, createIdleFeatures, OUTPUT_DELAY_SECONDS, type Analysis, type AudioFeatures } from '../visual/analysis.ts';

type Deck = {
	element: HTMLAudioElement;
	trackId: string;
	source: MediaElementAudioSourceNode | null;
	startAt: number | null;
	pendingSeek: (() => void) | null;
	blocked: boolean;
	pausedAt: number | null;
};

export type EngineListener = {
	ended(): void;
	failed(message: string): void;
	changed(): void;
};

export type StartResult = 'playing' | 'blocked' | 'stopped';

const MAX_DELAY_SECONDS = 1;

// iPhone/iPad run in "plain" mode: iOS suspends Web Audio when the screen locks, and switching
// decks at a track change seemed to wake the screen. So every track plays on ONE element there:
// no Web Audio graph, no gapless preloading, no music-reactive background, volume from the
// hardware buttons.
const appleMobile = () =>
	/iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

export class AudioEngine {
	private readonly decks: [Deck, Deck];
	private activeDeck = 0;
	private context: AudioContext | null = null;
	private input: GainNode | null = null;
	private output: GainNode | null = null;
	private analysis: Analysis | null = null;
	private level = 1;
	private readonly idleFeatures = createIdleFeatures();
	private readonly plain = appleMobile();

	constructor(private readonly listener: EngineListener) {
		this.decks = [this.createDeck(), this.createDeck()];
	}

	private createDeck(): Deck {
		const element = new Audio();
		element.preload = 'auto';
		const deck: Deck = { element, trackId: '', source: null, startAt: null, pendingSeek: null, blocked: false, pausedAt: null };
		// The start position is applied once playback actually starts: Safari loads nothing before
		// the first gesture, and iOS Safari accepts a seek on a never-played element but then plays
		// from 0:00 with currentTime frozen.
		element.addEventListener('playing', () => {
			if (deck.startAt !== null && Math.abs(element.currentTime - deck.startAt) > PLAYBACK.startToleranceSeconds)
				element.currentTime = deck.startAt;
			deck.startAt = null;
			deck.pausedAt = null;
		});
		element.addEventListener('pause', () => {
			deck.pausedAt = performance.now();
		});
		// The standby deck is preloading the next track; its events must not drive the player.
		const fromActive = (handler: () => void) => () => {
			if (this.decks[this.activeDeck] === deck) handler();
		};
		element.addEventListener(
			'ended',
			fromActive(() => this.listener.ended())
		);
		element.addEventListener(
			'error',
			fromActive(() => this.listener.failed(element.error?.message || 'Playback failed'))
		);
		for (const name of ['play', 'pause', 'playing', 'waiting', 'durationchange', 'seeked'])
			element.addEventListener(
				name,
				fromActive(() => this.listener.changed())
			);
		return deck;
	}

	// Built once, lazily, on a play attempt: createMediaElementSource can only be called once per
	// element, and audio routed into a suspended AudioContext is silent until a user gesture resumes it.
	// The delay holds the audible output back (OUTPUT_DELAY_SECONDS) so the kick detector, which
	// analyses the undelayed input, can react in time and the background tremble lands on the beat.
	private ensureGraph() {
		if (this.plain) return null;
		if (this.context) return this.context;
		const context = new AudioContext({ latencyHint: 'playback' });
		const input = context.createGain();
		const delay = context.createDelay(MAX_DELAY_SECONDS);
		delay.delayTime.value = OUTPUT_DELAY_SECONDS;
		const output = context.createGain();
		output.gain.value = this.level;
		input.connect(delay).connect(output).connect(context.destination);
		for (const deck of this.decks) {
			deck.source = context.createMediaElementSource(deck.element);
			deck.source.connect(input);
		}
		this.context = context;
		this.input = input;
		this.output = output;
		this.analysis = createAnalysis(context, input);
		return context;
	}

	private get active(): Deck {
		return this.decks[this.activeDeck];
	}

	private get standby(): Deck {
		return this.decks[1 - this.activeDeck];
	}

	get trackId() {
		return this.active.trackId;
	}

	get playing() {
		return !this.active.element.paused && !this.active.element.ended;
	}

	get position() {
		// While blocked (waiting for a tap) or reloading, the element's currentTime is meaningless;
		// the wanted position lives in startAt.
		if (this.active.startAt !== null && (this.active.blocked || this.active.element.readyState < HTMLMediaElement.HAVE_FUTURE_DATA))
			return this.active.startAt;
		return this.active.element.currentTime || 0;
	}

	get duration() {
		const duration = this.active.element.duration;
		return Number.isFinite(duration) ? duration : 0;
	}

	get buffering() {
		return this.playing && this.active.element.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
	}

	async load(trackId: string, url: string, options: { autoplay: boolean; startAt?: number }): Promise<StartResult> {
		if (options.autoplay) this.ensureGraph();
		const previous = this.active;
		// Gapless path: the standby deck already preloaded this track, so just swap decks.
		if (this.standby.trackId === trackId && this.standby.element.src.endsWith(url)) {
			this.activeDeck = 1 - this.activeDeck;
		} else {
			this.active.trackId = trackId;
			this.active.element.src = url;
		}
		const deck = this.active;
		if (previous !== deck) {
			previous.element.pause();
			// Removing src and calling load() is the standard way to make an element drop its download.
			previous.element.removeAttribute('src');
			previous.element.load();
			previous.trackId = '';
		}
		this.analysis?.reset();
		deck.startAt = null;
		deck.blocked = false;
		deck.pausedAt = null;
		this.dropPendingSeek(deck);
		if (options.startAt) this.seekDeck(deck, options.startAt);
		else if (deck.element.currentTime) deck.element.currentTime = 0;
		this.listener.changed();
		return options.autoplay ? this.resume() : 'stopped';
	}

	// Preloads the next track on the standby deck (skipped in plain mode, which uses one element).
	prepare(trackId: string | null, url: string | null) {
		if (this.plain) return;
		const deck = this.standby;
		if (!trackId || !url) {
			if (deck.trackId) {
				deck.element.removeAttribute('src');
				deck.element.load();
				deck.trackId = '';
			}
			return;
		}
		if (deck.trackId === trackId) return;
		deck.trackId = trackId;
		deck.element.src = url;
		deck.element.load();
	}

	// No seek is sent to a blocked deck (see the 'playing' handler); startAt alone carries it.
	private seekDeck(deck: Deck, seconds: number) {
		this.dropPendingSeek(deck);
		if (deck.element.paused) deck.startAt = seconds;
		if (deck.blocked) return;
		const apply = () => {
			deck.pendingSeek = null;
			deck.element.currentTime = seconds;
		};
		// Seeking before metadata is loaded is not reliable, so wait for it.
		if (deck.element.readyState >= HTMLMediaElement.HAVE_METADATA) apply();
		else {
			deck.pendingSeek = apply;
			deck.element.addEventListener('loadedmetadata', apply, { once: true });
		}
	}

	private dropPendingSeek(deck: Deck) {
		if (deck.pendingSeek) deck.element.removeEventListener('loadedmetadata', deck.pendingSeek);
		deck.pendingSeek = null;
	}

	private markBlocked(deck: Deck): StartResult {
		deck.startAt ??= deck.element.currentTime;
		deck.blocked = true;
		this.dropPendingSeek(deck);
		return 'blocked';
	}

	async resume(): Promise<StartResult> {
		if (!this.active.trackId) return 'stopped';
		const context = this.ensureGraph();
		const resumed = context?.state === 'suspended' ? context.resume() : Promise.resolve();
		const deck = this.active;
		const element = deck.element;
		// The tap that unblocks reloads the track inside the gesture; startAt is applied on 'playing'.
		// On iPhone a long pause in the background also needs a reload: iOS drops the paused page's
		// connection, and play() then reports playing while no audio arrives.
		const stale = this.plain && deck.pausedAt !== null && performance.now() - deck.pausedAt > PLAYBACK.reloadAfterPauseMs;
		if (deck.blocked || stale) {
			deck.startAt ??= element.currentTime;
			deck.blocked = false;
			this.dropPendingSeek(deck);
			element.load();
		}
		try {
			await element.play();
		} catch (error) {
			// AbortError: play() was interrupted by a newer load or pause, not a real failure.
			if (error instanceof DOMException && error.name === 'AbortError') return 'stopped';
			// NotAllowedError: autoplay policy wants a user gesture; the player shows "tap to play".
			if (error instanceof DOMException && error.name === 'NotAllowedError') return this.markBlocked(deck);
			this.listener.failed(error instanceof Error ? error.message : String(error));
			return 'stopped';
		}
		if (!context) return 'playing';
		// The element may play while the AudioContext stays suspended (no gesture yet), which would be
		// silent. resume() can also hang without a gesture, hence the timeout.
		await Promise.race([resumed.catch(() => {}), new Promise((resolve) => setTimeout(resolve, PLAYBACK.contextResumeTimeoutMs))]);
		if (context.state === 'running') return 'playing';
		element.pause();
		return this.markBlocked(deck);
	}

	// Called on every user gesture: the only moment a suspended AudioContext is allowed to resume.
	wake() {
		const context = this.ensureGraph();
		if (context?.state === 'suspended') void context.resume().catch(() => {});
	}

	pause() {
		this.active.element.pause();
	}

	stop() {
		this.active.element.pause();
		this.seekDeck(this.active, 0);
	}

	seek(seconds: number) {
		this.seekDeck(this.active, Math.max(0, Math.min(seconds, this.duration || seconds)));
	}

	setLevel(level: number) {
		this.level = level;
		if (this.plain) for (const deck of this.decks) deck.element.volume = level;
		// A short ramp instead of a jump avoids audible clicks.
		if (this.output && this.context) this.output.gain.setTargetAtTime(level, this.context.currentTime, 0.01);
	}

	sample(nowMs: number): Readonly<AudioFeatures> {
		return this.analysis?.sample(nowMs, this.playing) ?? this.idleFeatures;
	}

	get live() {
		return !!this.analysis && !!this.input;
	}
}
