import { GESTURE, PANEL, ROW_SWIPE } from '../tuning.ts';
import { closeAllMenus } from '../ui/menu.svelte.ts';
import { bodyHasClass, setBodyClass } from './dom.ts';
import { applyPanelProgress, panelProgress, panelProgressOnScreen, snapPanel } from './panel.ts';
import { animateRailTo, applyRailProgress, commitRailState, isInRailGestureZone, railProgress, railProgressForDelta, stopRailAnimation } from './rail.ts';
import { dropLiftedRow, liftRowForSwipe, moveLiftedRow, queueRowAtEvent, rowSwipeProgress, slideLiftedRowOut, springLiftedRowBack, swipe } from './rowSwipe.ts';

type Zone = 'rail' | 'panel' | 'row';

const gesture = {
	active: false,
	zone: 'panel' as Zone,
	row: null as HTMLElement | null,
	endReachedAt: null as number | null,
	silenceTimer: undefined as ReturnType<typeof setTimeout> | undefined,
	lastDelta: 0,
	momentumTail: null as { lastEventAt: number; lastDelta: number; risingEvents: number } | null
};

const axis = { direction: null as 'x' | 'y' | null, distanceX: 0, distanceY: 0, signedDistanceX: 0, lastEventAt: 0 };

function resetAxis() {
	axis.direction = null;
	axis.distanceX = 0;
	axis.distanceY = 0;
	axis.signedDistanceX = 0;
}

function beginMomentumTail() {
	gesture.momentumTail = { lastEventAt: performance.now(), lastDelta: gesture.lastDelta, risingEvents: 0 };
	resetAxis();
}

const setGestureSelectionLock = (locked: boolean) => setBodyClass('no-select', locked);

const zoneProgress = () => (gesture.zone === 'rail' ? railProgress() : panelProgress());

function commitRowSwipe(row: HTMLElement) {
	clearTimeout(gesture.silenceTimer);
	setGestureSelectionLock(false);
	gesture.active = false;
	gesture.row = null;
	beginMomentumTail();
	slideLiftedRowOut(row);
}

function finishAtClampedEnd() {
	clearTimeout(gesture.silenceTimer);
	if (!gesture.active) return;
	gesture.active = false;
	gesture.endReachedAt = null;
	setGestureSelectionLock(false);
	beginMomentumTail();
	const open = zoneProgress() >= GESTURE.snapToOpenProgress;
	if (gesture.zone === 'rail') commitRailState(open);
	else snapPanel(open);
}

function finishRowGestureAfterSilence() {
	const row = gesture.row;
	gesture.active = false;
	gesture.row = null;
	if (!row || !row.isConnected) {
		dropLiftedRow(row);
		return;
	}
	if (rowSwipeProgress() >= ROW_SWIPE.commitOnSilenceProgress) {
		commitRowSwipe(row);
		return;
	}
	beginMomentumTail();
	springLiftedRowBack(row);
}

function finishAfterSilence() {
	clearTimeout(gesture.silenceTimer);
	gesture.endReachedAt = null;
	setGestureSelectionLock(false);
	if (gesture.zone === 'row') {
		finishRowGestureAfterSilence();
		return;
	}
	gesture.active = false;
	const snapToOpen = zoneProgress() >= GESTURE.snapToOpenProgress;
	beginMomentumTail();
	if (gesture.zone === 'rail') animateRailTo(snapToOpen ? 1 : 0);
	else snapPanel(snapToOpen);
}

function swallowedByMomentumTail(event: WheelEvent, now: number) {
	const tail = gesture.momentumTail;
	if (!tail) return false;
	const deltaX = event.deltaX;
	const isHorizontal = Math.abs(deltaX) >= Math.abs(event.deltaY) && Math.abs(deltaX) > GESTURE.minimumHorizontalDeltaPx;
	let startsNewGesture = now - tail.lastEventAt >= GESTURE.tailGapForNewGestureMs;
	if (!startsNewGesture && isHorizontal) {
		if (tail.lastDelta && Math.sign(deltaX) !== Math.sign(tail.lastDelta)) startsNewGesture = true;
		else {
			tail.risingEvents = tail.lastDelta && Math.abs(deltaX) > Math.abs(tail.lastDelta) ? tail.risingEvents + 1 : 0;
			if (tail.risingEvents >= GESTURE.tailRisesForNewGesture) startsNewGesture = true;
		}
	}
	if (startsNewGesture) {
		gesture.momentumTail = null;
		resetAxis();
		axis.lastEventAt = now;
		return false;
	}
	tail.lastEventAt = now;
	if (isHorizontal) {
		tail.lastDelta = deltaX;
		event.preventDefault();
	}
	return true;
}

function decideAxis(event: WheelEvent, now: number): number | null {
	const silenceMs = gesture.active && gesture.zone === 'row' ? GESTURE.rowSilenceEndMs : GESTURE.silenceEndMs;
	if (now - axis.lastEventAt > silenceMs) resetAxis();
	axis.lastEventAt = now;
	if (axis.direction) return event.deltaX;
	axis.distanceX += Math.abs(event.deltaX);
	axis.distanceY += Math.abs(event.deltaY);
	axis.signedDistanceX += event.deltaX;
	if (Math.max(axis.distanceX, axis.distanceY) < GESTURE.axisDecisionDistancePx) return null;
	axis.direction = axis.distanceX > axis.distanceY ? 'x' : 'y';
	return axis.signedDistanceX;
}

function isOverHorizontalScroller(element: EventTarget | null) {
	for (let current = element instanceof Element ? element : null; current && current !== document.body; current = current.parentElement) {
		const scrollsSideways = current.scrollWidth > current.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(current).overflowX);
		if (scrollsSideways) return true;
	}
	return false;
}

function startGesture(event: WheelEvent) {
	const row = queueRowAtEvent(event);
	if (row) {
		gesture.active = true;
		gesture.zone = 'row';
		gesture.row = row;
		closeAllMenus();
		liftRowForSwipe(row);
	} else {
		const inRailZone = !bodyHasClass('now-open') && isInRailGestureZone(event.clientX);
		if (!inRailZone && bodyHasClass('now-open')) return false;
		gesture.active = true;
		gesture.zone = inRailZone ? 'rail' : 'panel';
		closeAllMenus();
		if (inRailZone) stopRailAnimation();
		else applyPanelProgress(panelProgressOnScreen());
	}
	gesture.endReachedAt = null;
	setGestureSelectionLock(true);
	return true;
}

function followRowGesture(deltaX: number) {
	if (!gesture.row || !gesture.row.isConnected) {
		clearTimeout(gesture.silenceTimer);
		dropLiftedRow(gesture.row);
		gesture.active = false;
		gesture.row = null;
		setGestureSelectionLock(false);
		return;
	}
	swipe.offsetPx -= deltaX;
	moveLiftedRow();
	clearTimeout(gesture.silenceTimer);
	if (rowSwipeProgress() >= ROW_SWIPE.commitImmediatelyProgress) {
		commitRowSwipe(gesture.row);
		return;
	}
	gesture.silenceTimer = setTimeout(finishAfterSilence, GESTURE.rowSilenceEndMs);
}

function followSidebarOrPanel(deltaX: number, now: number) {
	if (gesture.zone === 'rail') applyRailProgress(railProgressForDelta(deltaX));
	else applyPanelProgress(panelProgress() + deltaX / PANEL.slideDistancePx);
	clearTimeout(gesture.silenceTimer);
	const progress = zoneProgress();
	const pinnedAtEnd = progress <= 0 || progress >= 1;
	if (!pinnedAtEnd) {
		gesture.endReachedAt = null;
		gesture.silenceTimer = setTimeout(finishAfterSilence, GESTURE.silenceEndMs);
		return;
	}
	if (gesture.endReachedAt === null) gesture.endReachedAt = now;
	const heldFor = now - gesture.endReachedAt;
	if (heldFor >= GESTURE.endHoldMs) {
		finishAtClampedEnd();
		return;
	}
	gesture.silenceTimer = setTimeout(finishAtClampedEnd, GESTURE.endHoldMs - heldFor);
}

function handleWheel(event: WheelEvent) {
	if (event.ctrlKey) return;
	const now = performance.now();
	if (swallowedByMomentumTail(event, now)) return;
	const deltaX = decideAxis(event, now);
	if (deltaX === null) return;
	if (axis.direction === 'y' || event.shiftKey || event.deltaMode !== 0) return;
	const looksLikeMouseWheel = Math.abs(deltaX) > GESTURE.mouseWheelStepThresholdPx;
	if (!gesture.active && (looksLikeMouseWheel || (isOverHorizontalScroller(event.target) && !queueRowAtEvent(event)))) return;
	event.preventDefault();
	gesture.lastDelta = deltaX;
	if (!gesture.active) {
		if (Math.abs(deltaX) < GESTURE.minimumHorizontalDeltaPx) return;
		if (!startGesture(event)) return;
	}
	if (gesture.zone === 'row') followRowGesture(deltaX);
	else followSidebarOrPanel(deltaX, now);
}

export function installGestureRecognizer() {
	addEventListener('wheel', handleWheel, { passive: false });
	return () => removeEventListener('wheel', handleWheel);
}
