import { PLAYBACK } from '../tuning.ts';
import { createAnalysis, createIdleFeatures, OUTPUT_DELAY_SECONDS, type Analysis, type AudioFeatures } from '../visual/analysis.ts';

type Deck = {
	element: HTMLAudioElement;
	trackId: string;
	source: MediaElementAudioSourceNode | null;
	startAt: number | null;
	pendingSeek: (() => void) | null;
	blocked: boolean;
};

export type EngineListener = {
	ended(): void;
	failed(message: string): void;
	changed(): void;
};

export type StartResult = 'playing' | 'blocked' | 'stopped';

const MAX_DELAY_SECONDS = 1;

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
		const deck: Deck = { element, trackId: '', source: null, startAt: null, pendingSeek: null, blocked: false };
		element.addEventListener('playing', () => {
			if (deck.startAt !== null && Math.abs(element.currentTime - deck.startAt) > PLAYBACK.startToleranceSeconds)
				element.currentTime = deck.startAt;
			deck.startAt = null;
		});
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
		if (this.active.blocked && this.active.startAt !== null) return this.active.startAt;
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
		if (this.standby.trackId === trackId && this.standby.element.src.endsWith(url)) {
			this.activeDeck = 1 - this.activeDeck;
		} else {
			this.active.trackId = trackId;
			this.active.element.src = url;
		}
		const deck = this.active;
		if (previous !== deck) {
			previous.element.pause();
			previous.element.removeAttribute('src');
			previous.element.load();
			previous.trackId = '';
		}
		this.analysis?.reset();
		deck.startAt = null;
		deck.blocked = false;
		this.dropPendingSeek(deck);
		if (options.startAt) this.seekDeck(deck, options.startAt);
		else if (deck.element.currentTime) deck.element.currentTime = 0;
		this.listener.changed();
		return options.autoplay ? this.resume() : 'stopped';
	}

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

	private seekDeck(deck: Deck, seconds: number) {
		this.dropPendingSeek(deck);
		if (deck.element.paused) deck.startAt = seconds;
		if (deck.blocked) return;
		const apply = () => {
			deck.pendingSeek = null;
			deck.element.currentTime = seconds;
		};
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
		if (deck.blocked) {
			deck.blocked = false;
			element.load();
		}
		try {
			await element.play();
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') return 'stopped';
			if (error instanceof DOMException && error.name === 'NotAllowedError') return this.markBlocked(deck);
			this.listener.failed(error instanceof Error ? error.message : String(error));
			return 'stopped';
		}
		if (!context) return 'playing';
		await Promise.race([resumed.catch(() => {}), new Promise((resolve) => setTimeout(resolve, PLAYBACK.contextResumeTimeoutMs))]);
		if (context.state === 'running') return 'playing';
		element.pause();
		return this.markBlocked(deck);
	}

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
		if (this.output && this.context) this.output.gain.setTargetAtTime(level, this.context.currentTime, 0.01);
	}

	sample(nowMs: number): Readonly<AudioFeatures> {
		return this.analysis?.sample(nowMs, this.playing) ?? this.idleFeatures;
	}

	get live() {
		return !!this.analysis && !!this.input;
	}
}
