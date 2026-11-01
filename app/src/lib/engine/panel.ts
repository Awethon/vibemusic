// The right-hand side panel (queue, lyrics, ...). During a swipe it is driven by inline
// transform + the --panel-w variable each frame; on release, snapPanel hands back to a CSS
// transition and settles the real open/closed state.
import { flushSync } from 'svelte';
import { EASING, PANEL } from '../tuning.ts';
import { ui, type PanelTab } from '../ui/state.svelte.ts';
import { bodyHasClass, prefersReducedMotion, setBodyClass } from './dom.ts';
import { captureTilePositions, playTileFlip } from './flip.ts';
import { recenterVisibleLyrics, relayoutAll, scheduleLiveLayout, settleLayout } from './layout.svelte.ts';

const panel = { progress: 0, transitionCleanupTimer: undefined as ReturnType<typeof setTimeout> | undefined };

const panelElement = () => document.getElementById('panel');

export const panelProgress = () => panel.progress;

function setPanelOpen(open: boolean) {
	ui.panelOpen = open;
	setBodyClass('panel-open', open);
}

function refreshOpenedPanel() {
	requestAnimationFrame(recenterVisibleLyrics);
}

export function showPanelTab(tab: PanelTab) {
	ui.panelTab = tab;
	if (tab === 'lyrics') requestAnimationFrame(recenterVisibleLyrics);
}

export function togglePanelWithLayout(open: boolean, tab?: PanelTab) {
	if (tab) showPanelTab(tab);
	if (open === bodyHasClass('panel-open')) return;
	// Order matters: measure tiles, render the new panel state, relayout, then FLIP from old spots.
	const previousPositions = captureTilePositions();
	setPanelOpen(open);
	flushSync();
	relayoutAll();
	playTileFlip(previousPositions);
	if (open) refreshOpenedPanel();
}

export function closePanelInstantly() {
	if (!bodyHasClass('panel-open')) return;
	setPanelOpen(false);
	flushSync();
	relayoutAll();
}

export function applyPanelProgress(progress: number) {
	panel.progress = Math.max(0, Math.min(1, progress));
	const element = panelElement();
	if (!element) return;
	// No transition while following the finger, or the panel would lag behind it.
	element.style.transition = 'none';
	element.style.transform = `translateX(${((1 - panel.progress) * PANEL.slideDistancePx).toFixed(1)}px)`;
	document.body.style.setProperty('--panel-w', `${(panel.progress * PANEL.contentInsetPx).toFixed(1)}px`);
	scheduleLiveLayout();
}

// Reads the computed transform (m41 = translateX) so a gesture can grab a panel that is still
// mid-way through its CSS snap transition.
export function panelProgressOnScreen() {
	const element = panelElement();
	if (!element) return 0;
	const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
	return Math.max(0, Math.min(1, 1 - matrix.m41 / PANEL.slideDistancePx));
}

export function snapPanel(open: boolean) {
	const element = panelElement();
	if (!element) return;
	const distance = Math.abs((open ? 1 : 0) - panel.progress);
	const durationMs = prefersReducedMotion() ? 0 : Math.max(PANEL.snapMinMs, PANEL.snapMs * distance);
	// Shorter snaps for shorter remaining distance. Clearing the inline transform lets the
	// stylesheet's open/closed position take over, animated by this one-off transition.
	element.style.transition = `transform ${durationMs}ms ${EASING.easeOutCubic}`;
	element.style.transform = '';
	document.body.style.removeProperty('--panel-w');
	if (open !== bodyHasClass('panel-open')) {
		setPanelOpen(open);
		flushSync();
		if (open) refreshOpenedPanel();
	}
	panel.progress = open ? 1 : 0;
	settleLayout();
	// Remove the one-off transition afterwards so the stylesheet's own transition applies again.
	clearTimeout(panel.transitionCleanupTimer);
	panel.transitionCleanupTimer = setTimeout(() => {
		element.style.transition = '';
	}, durationMs + PANEL.transitionCleanupMarginMs);
}
