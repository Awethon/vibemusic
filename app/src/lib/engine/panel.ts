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
	element.style.transition = 'none';
	element.style.transform = `translateX(${((1 - panel.progress) * PANEL.slideDistancePx).toFixed(1)}px)`;
	document.body.style.setProperty('--panel-w', `${(panel.progress * PANEL.contentInsetPx).toFixed(1)}px`);
	scheduleLiveLayout();
}

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
	clearTimeout(panel.transitionCleanupTimer);
	panel.transitionCleanupTimer = setTimeout(() => {
		element.style.transition = '';
	}, durationMs + PANEL.transitionCleanupMarginMs);
}
