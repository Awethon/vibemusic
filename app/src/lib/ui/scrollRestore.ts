import { mainScroller } from '../engine/dom.ts';
import { SCROLL_RESTORE } from '../tuning.ts';

const USER_INPUT = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

let active: (() => void) | null = null;

export function restoreMainScroll(target: number) {
	active?.();
	if (!target) return;
	let frame = 0;
	const started = performance.now();
	let reachedAt = 0;
	const stop = () => {
		cancelAnimationFrame(frame);
		for (const type of USER_INPUT) removeEventListener(type, stop, true);
		if (active === stop) active = null;
	};
	const step = (now: number) => {
		const scroller = mainScroller();
		if (scroller) {
			scroller.scrollTop = target;
			if (Math.abs(scroller.scrollTop - target) < SCROLL_RESTORE.reachedPx) reachedAt ||= now;
			else reachedAt = 0;
		}
		if ((reachedAt && now - reachedAt > SCROLL_RESTORE.settleMs) || now - started > SCROLL_RESTORE.giveUpMs) return stop();
		frame = requestAnimationFrame(step);
	};
	for (const type of USER_INPUT) addEventListener(type, stop, { capture: true, passive: true });
	active = stop;
	frame = requestAnimationFrame(step);
}
