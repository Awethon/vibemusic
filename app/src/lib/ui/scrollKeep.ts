import { mainScroller } from '../engine/dom.ts';
import { LAYOUT } from '../tuning.ts';

export function keepScrollNearGrid() {
	const scroller = mainScroller();
	const grid = scroller?.querySelector<HTMLElement>('#vlist');
	if (!scroller || !grid) return;
	const gridTop = grid.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
	scroller.scrollTop = Math.min(scroller.scrollTop, Math.max(0, gridTop - LAYOUT.rerenderScrollMarginPx));
}
