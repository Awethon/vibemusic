// Central relayout for everything whose size depends on the space left by the rail and panel.
// Grids register as participants; the rail and panel call in here every frame while they move.
// This calls flushSync, so Svelte effects that reach it must wrap the call in untrack.
import { flushSync } from 'svelte';
import { LAYOUT, MOTION } from '../tuning.ts';
import { captureTilePositions, playTileFlip } from './flip.ts';
import { setBodyClass } from './dom.ts';

// refill: recompute from scratch (e.g. the column count changed); reflow: adjust within the
// current layout. needsRefill tells live layout whether this frame warrants a FLIP animation.
export type LayoutParticipant = {
	needsRefill(): boolean;
	refill(): void;
	reflow(): void;
};

const participants = new Set<LayoutParticipant>();
const lyricViews = new Set<() => void>();
let liveFrameId = 0;

export function registerLayout(participant: LayoutParticipant) {
	participants.add(participant);
	return () => {
		participants.delete(participant);
	};
}

export function registerLyricView(recenter: () => void) {
	lyricViews.add(recenter);
	return () => {
		lyricViews.delete(recenter);
	};
}

export function recenterVisibleLyrics() {
	for (const recenter of lyricViews) recenter();
}

function refillAll() {
	// Each flushSync puts state changes into the DOM before the next pass (and the FLIP that
	// follows) measures it.
	for (const participant of participants) participant.refill();
	flushSync();
	for (const participant of participants) participant.reflow();
	flushSync();
}

export function relayoutAll() {
	refillAll();
	recenterVisibleLyrics();
}

function liveLayout(glideMs: number) {
	if ([...participants].some((participant) => participant.needsRefill())) {
		const previousPositions = captureTilePositions();
		refillAll();
		playTileFlip(previousPositions, glideMs);
	} else {
		for (const participant of participants) participant.reflow();
		flushSync();
	}
	recenterVisibleLyrics();
}

// Called on every gesture/animation step; coalesced to one layout per animation frame.
export function scheduleLiveLayout() {
	if (liveFrameId) return;
	liveFrameId = requestAnimationFrame(() => {
		liveFrameId = 0;
		liveLayout(MOTION.liveFlipMs);
	});
}

// Final layout when a rail/panel motion ends: drops any pending live frame and runs now.
export function settleLayout() {
	cancelAnimationFrame(liveFrameId);
	liveFrameId = 0;
	liveLayout(MOTION.flipMs);
}

export type AlphabetEntry = { label: string; index: number };

export const alphabet = $state<{ entries: AlphabetEntry[]; current: number; jump: ((entryIndex: number) => void) | null }>({
	entries: [],
	current: -1,
	jump: null
});

export function showAlphabet(entries: AlphabetEntry[] | null, jump: ((entryIndex: number) => void) | null) {
	alphabet.entries = entries ?? [];
	alphabet.jump = entries ? jump : null;
	alphabet.current = -1;
	setBodyClass('has-az', !!entries);
}

export function alphabetEntriesFor<T>(items: T[], bucketOf: ((item: T) => string) | null): AlphabetEntry[] | null {
	if (!bucketOf) return null;
	const entries: AlphabetEntry[] = [];
	let previous: string | null = null;
	items.forEach((item, index) => {
		const bucket = bucketOf(item);
		if (bucket !== previous) {
			entries.push({ label: bucket, index });
			previous = bucket;
		}
	});
	// A single-letter index is useless, so hide it.
	return entries.length > 1 ? entries : null;
}

let resizeTimer: ReturnType<typeof setTimeout> | undefined;

export function installResizeRelayout() {
	const onResize = () => {
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(relayoutAll, LAYOUT.resizeDebounceMs);
	};
	addEventListener('resize', onResize);
	return () => removeEventListener('resize', onResize);
}
