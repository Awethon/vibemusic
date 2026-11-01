import { EASING, MOTION } from '../tuning.ts';
import { mainScroller, prefersReducedMotion } from './dom.ts';

const FLIP_TILE_SELECTOR = '#vlist > *, .shelf > *, .bb-body > *, .grid > *';

function flipKeyOf(tile: HTMLElement): string | null {
	const itemId = tile.dataset.id || tile.dataset.album;
	if (!itemId) return null;
	const container = tile.parentElement!;
	const kindContainer = container.closest<HTMLElement>('[data-kind]');
	const containerName = container.id || kindContainer?.dataset.kind || 'grid';
	return `${containerName}:${itemId}`;
}

const isOnScreen = (rect: DOMRect) => !(rect.bottom < 0 || rect.top > innerHeight || !rect.width);

const tiles = () => mainScroller()?.querySelectorAll<HTMLElement>(FLIP_TILE_SELECTOR) ?? [];

export function captureTilePositions(): Map<string, DOMRect> {
	const positions = new Map<string, DOMRect>();
	if (prefersReducedMotion()) return positions;
	for (const tile of tiles()) {
		const rect = tile.getBoundingClientRect();
		if (!isOnScreen(rect)) continue;
		const key = flipKeyOf(tile);
		if (key) positions.set(key, rect);
	}
	return positions;
}

function glideFromPreviousPosition(tile: HTMLElement, previous: DOMRect, current: DOMRect, delay: number, durationMs: number) {
	const offsetX = previous.left - current.left;
	const offsetY = previous.top - current.top;
	const scale = previous.width / current.width;
	const unchanged =
		Math.abs(offsetX) < MOTION.flipMinOffsetPx &&
		Math.abs(offsetY) < MOTION.flipMinOffsetPx &&
		Math.abs(scale - 1) < MOTION.flipMinScaleChange;
	if (unchanged) return;
	const restingTransform = tile.style.transform || '';
	tile.animate(
		[
			{ transform: `translate(${offsetX}px, ${offsetY}px) ${restingTransform} scale(${scale})`, transformOrigin: '0 0' },
			{ transform: `${restingTransform || 'translate(0px, 0px)'} scale(1)`, transformOrigin: '0 0' }
		],
		{ duration: durationMs, delay, easing: EASING.standard, fill: 'backwards' }
	);
}

function fadeIn(tile: HTMLElement, delay: number, durationMs: number) {
	tile.animate([{ opacity: 0 }, { opacity: 1 }], {
		duration: durationMs - MOTION.flipFadeShortenMs,
		delay,
		easing: EASING.standard,
		fill: 'backwards'
	});
}

export function playTileFlip(previousPositions: Map<string, DOMRect>, durationMs: number = MOTION.flipMs) {
	if (prefersReducedMotion() || !previousPositions.size) return;
	let animatedCount = 0;
	for (const tile of tiles()) {
		const current = tile.getBoundingClientRect();
		if (!isOnScreen(current)) continue;
		const key = flipKeyOf(tile);
		const previous = key ? previousPositions.get(key) : undefined;
		const delay = Math.min(MOTION.flipStaggerMaxMs, animatedCount++ * MOTION.flipStaggerStepMs);
		const travelledTooFar = previous && Math.abs(previous.top - current.top) >= innerHeight * MOTION.flipMaxVerticalTravelRatio;
		if (previous && !travelledTooFar) glideFromPreviousPosition(tile, previous, current, delay, durationMs);
		else fadeIn(tile, delay, durationMs);
	}
}
