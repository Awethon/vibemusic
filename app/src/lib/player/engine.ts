import { createAnalysis, createIdleFeatures, OUTPUT_DELAY_SECONDS, type Analysis, type AudioFeatures } from '../visual/analysis.ts';

type Deck = { element: HTMLAudioElement; trackId: string; source: MediaElementAudioSourceNode | null };

export type EngineListener = {
	ended(): void;
	failed(message: string): void;
	changed(): void;
};

export type StartResult = 'playing' | 'blocked' | 'stopped';

const MAX_DELAY_SECONDS = 1;
const CONTEXT_RESUME_TIMEOUT_MS = 1500;
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

const pageWasActivated = () => (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? true;

export class AudioEngine {
	private readonly decks: [Deck, Deck];
	private activeDeck = 0;
	private context: AudioContext | null = null;
	private input: GainNode | null = null;
	private output: GainNode | null = null;
	private analysis: Analysis | null = null;
	private level = 1;
	private primed = false;
	private readonly priming = new Set<HTMLAudioElement>();
	private startAttempt = 0;
	private readonly idleFeatures = createIdleFeatures();

	constructor(private readonly listener: EngineListener) {
		this.decks = [this.createDeck(), this.createDeck()];
	}

	private createDeck(): Deck {
		const element = new Audio();
		element.preload = 'auto';
		const deck: Deck = { element, trackId: '', source: null };
		const fromActive = (handler: () => void) => () => {
			if (this.decks[this.activeDeck] === deck) handler();
		};
		element.addEventListener('ended', fromActive(() => this.listener.ended()));
		element.addEventListener('error', fromActive(() => this.listener.failed(element.error?.message || 'Playback failed')));
		for (const name of ['play', 'pause', 'playing', 'waiting', 'durationchange', 'seeked']) element.addEventListener(name, fromActive(() => this.listener.changed()));
		return deck;
	}

	private ensureGraph() {
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
		return !this.active.element.paused && !this.active.element.ended && !this.priming.has(this.active.element);
	}

	get position() {
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
		if (options.startAt) this.seekDeck(deck, options.startAt);
		else if (deck.element.currentTime) deck.element.currentTime = 0;
		this.listener.changed();
		return options.autoplay ? this.resume() : 'stopped';
	}

	prepare(trackId: string | null, url: string | null) {
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
		const apply = () => (deck.element.currentTime = seconds);
		if (deck.element.readyState >= HTMLMediaElement.HAVE_METADATA) apply();
		else deck.element.addEventListener('loadedmetadata', apply, { once: true });
	}

	async resume(): Promise<StartResult> {
		if (!this.active.trackId) return 'stopped';
		this.startAttempt += 1;
		this.priming.clear();
		this.setLevel(this.level);
		if (!pageWasActivated()) return 'blocked';
		const context = this.ensureGraph();
		const resumed = context.state === 'suspended' ? context.resume() : Promise.resolve();
		const element = this.active.element;
		try {
			await element.play();
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') return 'stopped';
			if (error instanceof DOMException && error.name === 'NotAllowedError') return 'blocked';
			this.listener.failed(error instanceof Error ? error.message : String(error));
			return 'stopped';
		}
		await Promise.race([resumed.catch(() => {}), new Promise((resolve) => setTimeout(resolve, CONTEXT_RESUME_TIMEOUT_MS))]);
		if (context.state === 'running') return 'playing';
		element.pause();
		return 'blocked';
	}

	unlock() {
		const context = this.ensureGraph();
		if (context.state === 'suspended') void context.resume().catch(() => {});
		if (this.primed || this.playing) return;
		this.primed = true;
		const attempt = this.startAttempt;
		const silent = this.decks.filter((deck) => deck.element.paused);
		if (!silent.length) return;
		this.output?.gain.setValueAtTime(0, context.currentTime);
		for (const deck of silent) {
			const source = deck.element.getAttribute('src');
			const at = deck.element.currentTime;
			if (!source) deck.element.src = SILENCE;
			this.priming.add(deck.element);
			deck.element
				.play()
				.then(() => {
					if (attempt !== this.startAttempt) return;
					deck.element.pause();
					if (source) deck.element.currentTime = at;
					else {
						deck.element.removeAttribute('src');
						deck.element.load();
					}
				})
				.catch(() => {})
				.finally(() => {
					this.priming.delete(deck.element);
					if (attempt === this.startAttempt) this.setLevel(this.level);
				});
		}
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
		if (this.output && this.context) this.output.gain.setTargetAtTime(level, this.context.currentTime, 0.01);
	}

	sample(nowMs: number): Readonly<AudioFeatures> {
		return this.analysis?.sample(nowMs, this.playing) ?? this.idleFeatures;
	}

	get live() {
		return !!this.analysis && !!this.input;
	}
}
