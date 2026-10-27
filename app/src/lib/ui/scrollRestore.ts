import { mainScroller } from '../engine/dom.ts';

const SETTLE_MS = 400;
const GIVE_UP_MS = 2500;
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
			if (Math.abs(scroller.scrollTop - target) < 2) reachedAt ||= now;
			else reachedAt = 0;
		}
		if ((reachedAt && now - reachedAt > SETTLE_MS) || now - started > GIVE_UP_MS) return stop();
		frame = requestAnimationFrame(step);
	};
	for (const type of USER_INPUT) addEventListener(type, stop, { capture: true, passive: true });
	active = stop;
	frame = requestAnimationFrame(step);
}
