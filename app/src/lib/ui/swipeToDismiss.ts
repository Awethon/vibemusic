import type { Attachment } from 'svelte/attachments';
import { LAYOUT } from '../tuning.ts';

type Drag = { pointerId: number; x: number; y: number; lastY: number; lastAt: number; speed: number; down: boolean | null };

// Touch-only pull-down-to-close for phone sheets (full-screen player, side panel). The first few px
// decide the direction; a sideways start is left to the page. Closes on distance or flick speed.
// Controls that drag themselves never start a pull.
const IGNORED = '.slider, input, textarea, select';

export function swipeToDismiss(onDismiss: () => void, handle?: string): Attachment<HTMLElement> {
	return (sheet) => {
		let drag: Drag | null = null;

		const release = () => {
			sheet.style.transition = '';
			sheet.style.transform = '';
		};

		const down = (event: PointerEvent) => {
			if (event.pointerType !== 'touch' || !(event.target instanceof Element)) return;
			if (event.target.closest(IGNORED) || (handle && !event.target.closest(handle))) return;
			drag = {
				pointerId: event.pointerId,
				x: event.clientX,
				y: event.clientY,
				lastY: event.clientY,
				lastAt: event.timeStamp,
				speed: 0,
				down: null
			};
		};

		const move = (event: PointerEvent) => {
			if (!drag || event.pointerId !== drag.pointerId) return;
			const dx = event.clientX - drag.x;
			const dy = event.clientY - drag.y;
			if (drag.down === null) {
				if (Math.hypot(dx, dy) < LAYOUT.swipeSlopPx) return;
				drag.down = dy > Math.abs(dx);
				if (!drag.down) return void (drag = null);
			}
			const elapsed = event.timeStamp - drag.lastAt;
			if (elapsed > 0) drag.speed = (event.clientY - drag.lastY) / elapsed;
			drag.lastY = event.clientY;
			drag.lastAt = event.timeStamp;
			sheet.style.transition = 'none';
			sheet.style.transform = `translateY(${Math.max(0, dy)}px)`;
		};

		const up = (event: PointerEvent) => {
			if (!drag || event.pointerId !== drag.pointerId) return;
			const pulled = drag.down ? event.clientY - drag.y : 0;
			const { speed } = drag;
			drag = null;
			if (!pulled) return;
			release();
			if (pulled > LAYOUT.swipeDismissPx || speed > LAYOUT.swipeDismissPxPerMs) onDismiss();
		};

		const cancel = (event: PointerEvent) => {
			if (drag && event.pointerId === drag.pointerId) {
				drag = null;
				release();
			}
		};

		sheet.addEventListener('pointerdown', down);
		sheet.addEventListener('pointermove', move);
		sheet.addEventListener('pointerup', up);
		sheet.addEventListener('pointercancel', cancel);
		return () => {
			sheet.removeEventListener('pointerdown', down);
			sheet.removeEventListener('pointermove', move);
			sheet.removeEventListener('pointerup', up);
			sheet.removeEventListener('pointercancel', cancel);
			release();
		};
	};
}
