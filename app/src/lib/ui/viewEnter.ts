import { prefersReducedMotion } from '../engine/dom.ts';
import { EASING, MOTION } from '../tuning.ts';

export function viewEnter(node: HTMLElement) {
	if (prefersReducedMotion()) return;
	node.animate(
		[
			{ opacity: 0, transform: `translateY(${MOTION.viewEnterRisePx}px)` },
			{ opacity: 1, transform: 'none' }
		],
		{ duration: MOTION.viewEnterMs, easing: EASING.standard }
	);
}
