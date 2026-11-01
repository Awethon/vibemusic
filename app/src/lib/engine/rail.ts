import { RAIL } from '../tuning.ts';
import { writePreference } from '../ui/preferences.ts';
import { ui } from '../ui/state.svelte.ts';
import { closeAllMenus } from '../ui/menu.svelte.ts';
import { prefersReducedMotion, setRootVariable } from './dom.ts';
import { scheduleLiveLayout, settleLayout } from './layout.svelte.ts';

const RAIL_WIDTH_RANGE = RAIL.expandedWidthPx - RAIL.collapsedWidthPx;
const easeOutCubic = (progress: number) => 1 - Math.pow(1 - progress, 3);

const rail = { progress: 0, target: 0, animationFrameId: 0 };

const railWidthPx = () => RAIL.collapsedWidthPx + RAIL_WIDTH_RANGE * rail.progress;

export const railProgress = () => rail.progress;

export const railProgressForDelta = (deltaPx: number) => rail.progress - deltaPx / RAIL_WIDTH_RANGE;

export const isInRailGestureZone = (clientX: number) => clientX <= RAIL.leftInsetPx + railWidthPx() + RAIL.gestureZoneMarginPx;

export function applyRailProgress(progress: number) {
	rail.progress = Math.max(0, Math.min(1, progress));
	const labelReveal = Math.max(0, (rail.progress - RAIL.labelRevealStartProgress) / (1 - RAIL.labelRevealStartProgress));
	setRootVariable('--rail-w', `${railWidthPx().toFixed(2)}px`);
	setRootVariable('--rail-p', rail.progress.toFixed(3));
	setRootVariable('--rail-l', labelReveal.toFixed(3));
	scheduleLiveLayout();
}

function settleRail(expanded: boolean, persist: boolean) {
	if (persist) writePreference('rail', expanded ? 'open' : 'mini');
	ui.railExpanded = expanded;
	settleLayout();
}

export function stopRailAnimation() {
	cancelAnimationFrame(rail.animationFrameId);
	rail.animationFrameId = 0;
}

export function animateRailTo(targetProgress: number) {
	rail.target = targetProgress;
	stopRailAnimation();
	const startProgress = rail.progress;
	const durationMs =
		prefersReducedMotion() || document.hidden
			? 0
			: Math.max(RAIL.animationMinMs, RAIL.animationMs * Math.abs(targetProgress - startProgress));
	if (!durationMs) {
		applyRailProgress(targetProgress);
		settleRail(targetProgress === 1, true);
		return;
	}
	const startedAt = performance.now();
	const step = (now: number) => {
		const elapsed = Math.min(1, (now - startedAt) / durationMs);
		applyRailProgress(startProgress + (targetProgress - startProgress) * easeOutCubic(elapsed));
		if (elapsed < 1) {
			rail.animationFrameId = requestAnimationFrame(step);
			return;
		}
		rail.animationFrameId = 0;
		settleRail(targetProgress === 1, true);
	};
	rail.animationFrameId = requestAnimationFrame(step);
}

export function commitRailState(expanded: boolean) {
	rail.target = expanded ? 1 : 0;
	settleRail(expanded, true);
}

export function setRailExpanded(expanded: boolean, instant: boolean) {
	closeAllMenus();
	if (instant) {
		rail.target = expanded ? 1 : 0;
		applyRailProgress(rail.target);
		settleRail(expanded, false);
		return;
	}
	animateRailTo(expanded ? 1 : 0);
}

export const toggleRail = () => setRailExpanded(rail.target !== 1, false);
