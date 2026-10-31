import { LAYOUT } from '../tuning.ts';

type Press = { pointerId: number; x: number; y: number; target: Element; timer: ReturnType<typeof setTimeout> };

export function installLongPress(): () => void {
	let press: Press | null = null;
	let swallowClick = false;

	const cancel = () => {
		if (press) clearTimeout(press.timer);
		press = null;
	};

	const down = (event: PointerEvent) => {
		cancel();
		if (event.pointerType !== 'touch' || !(event.target instanceof Element)) return;
		const target = event.target;
		const { pointerId, clientX: x, clientY: y } = event;
		press = {
			pointerId,
			x,
			y,
			target,
			timer: setTimeout(() => {
				press = null;
				const opened = !target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
				if (!opened) return;
				swallowClick = true;
				navigator.vibrate?.(10);
			}, LAYOUT.longPressMs)
		};
	};

	const move = (event: PointerEvent) => {
		if (press && event.pointerId === press.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > LAYOUT.longPressMovePx) cancel();
	};

	const click = (event: MouseEvent) => {
		if (!swallowClick) return;
		swallowClick = false;
		event.preventDefault();
		event.stopPropagation();
	};

	const nativeMenu = (event: MouseEvent) => {
		if (event.isTrusted) cancel();
	};

	const options = { capture: true, passive: true } as const;
	addEventListener('pointerdown', down, options);
	addEventListener('pointermove', move, options);
	addEventListener('pointerup', cancel, options);
	addEventListener('pointercancel', cancel, options);
	addEventListener('scroll', cancel, options);
	addEventListener('contextmenu', nativeMenu, { capture: true });
	addEventListener('click', click, { capture: true });
	return () => {
		cancel();
		removeEventListener('pointerdown', down, options);
		removeEventListener('pointermove', move, options);
		removeEventListener('pointerup', cancel, options);
		removeEventListener('pointercancel', cancel, options);
		removeEventListener('scroll', cancel, options);
		removeEventListener('contextmenu', nativeMenu, { capture: true });
		removeEventListener('click', click, { capture: true });
	};
}
