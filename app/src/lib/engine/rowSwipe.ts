import { EASING, ROW_SWIPE } from '../tuning.ts';
import { removeRowAfterSwipe } from '../ui/queueActions.ts';
import { prefersReducedMotion } from './dom.ts';
import { QUEUE_ROW_SELECTOR } from './queueAnimation.ts';

export const swipe = {
	liftedRow: null as HTMLElement | null,
	frozenScroller: null as HTMLElement | null,
	offsetPx: 0,
	widthPx: 1
};

export function queueRowAtEvent(event: MouseEvent): HTMLElement | null {
	const target = event.target instanceof Element ? event.target : null;
	const directHit = target?.closest<HTMLElement>(QUEUE_ROW_SELECTOR);
	if (directHit) return directHit;
	return document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(QUEUE_ROW_SELECTOR) ?? null;
}

export const rowSwipeProgress = () => Math.max(0, -swipe.offsetPx) / swipe.widthPx;

const rowOpacityAt = (progress: number) => Math.pow(1 - Math.min(1, progress / ROW_SWIPE.fadeEndProgress), ROW_SWIPE.fadeExponent);

export function liftRowForSwipe(row: HTMLElement) {
	const rect = row.getBoundingClientRect();
	const lifted = row.cloneNode(true) as HTMLElement;
	for (const node of [lifted, ...lifted.querySelectorAll('[id]')]) node.removeAttribute('id');
	lifted.classList.add('row-lift');
	Object.assign(lifted.style, {
		left: `${rect.left}px`,
		top: `${rect.top}px`,
		width: `${rect.width}px`,
		height: `${rect.height}px`,
		transform: '',
		opacity: ''
	});
	document.body.append(lifted);
	row.style.visibility = 'hidden';
	const scroller = row.closest<HTMLElement>('.q-scroll');
	if (scroller) {
		swipe.frozenScroller = scroller;
		scroller.style.overflowY = 'hidden';
	}
	swipe.liftedRow = lifted;
	swipe.offsetPx = 0;
	swipe.widthPx = Math.max(1, row.offsetWidth);
}

export function dropLiftedRow(originalRow: HTMLElement | null) {
	if (originalRow) originalRow.style.visibility = '';
	swipe.liftedRow?.remove();
	swipe.liftedRow = null;
	if (swipe.frozenScroller) swipe.frozenScroller.style.overflowY = '';
	swipe.frozenScroller = null;
}

export function moveLiftedRow() {
	const lifted = swipe.liftedRow;
	if (!lifted) return;
	const progress = Math.min(1, rowSwipeProgress());
	const offset = swipe.offsetPx < 0 ? swipe.offsetPx : Math.min(ROW_SWIPE.rubberBandMaxPx, swipe.offsetPx * ROW_SWIPE.rubberBandFactor);
	lifted.style.transform = prefersReducedMotion() ? '' : `translateX(${offset.toFixed(1)}px)`;
	lifted.style.opacity = rowOpacityAt(progress).toFixed(3);
}

export function slideLiftedRowOut(originalRow: HTMLElement) {
	const lifted = swipe.liftedRow;
	if (!lifted) return;
	const exit = lifted.animate(
		[
			{ transform: lifted.style.transform || 'none', opacity: lifted.style.opacity || 1 },
			{ transform: prefersReducedMotion() ? 'none' : `translateX(${-lifted.offsetWidth * ROW_SWIPE.exitDistanceFactor}px)`, opacity: 0 }
		],
		{ duration: ROW_SWIPE.exitMs, easing: EASING.easeOutCubic, fill: 'forwards' }
	);
	exit.onfinish = () => {
		dropLiftedRow(null);
		removeRowAfterSwipe(originalRow);
	};
}

export function springLiftedRowBack(originalRow: HTMLElement) {
	const lifted = swipe.liftedRow;
	if (!lifted) return;
	const spring = lifted.animate(
		[
			{ transform: lifted.style.transform || 'none', opacity: lifted.style.opacity || 1 },
			{ transform: 'translateX(0px)', opacity: 1 }
		],
		{ duration: ROW_SWIPE.springBackMs, easing: EASING.easeOutCubic, fill: 'forwards' }
	);
	spring.onfinish = () => dropLiftedRow(originalRow);
}
