import { QUEUE_DRAG } from '../tuning.ts';
import { setBodyClass } from '../engine/dom.ts';
import { playUpNextRow, reorderUpNextRows } from './queueActions.ts';
import { ui } from './state.svelte.ts';

type Drag = { list: HTMLElement; row: HTMLElement; startY: number; dragging: boolean; rows: HTMLElement[]; fromIndex: number; toIndex: number; rowPitch: number };

let drag: Drag | null = null;

export function beginPress(event: PointerEvent) {
	const list = event.currentTarget as HTMLElement;
	const row = (event.target as Element).closest<HTMLElement>('li');
	if (!row || event.button !== 0 || !list.contains(row)) return;
	const rows = Array.from(list.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child.tagName === 'LI');
	const rowPitch = rows.length > 1 ? rows[1].offsetTop - rows[0].offsetTop : row.offsetHeight;
	const startIndex = rows.indexOf(row);
	drag = { list, row, startY: event.clientY, dragging: false, rows, fromIndex: startIndex, toIndex: startIndex, rowPitch };
	ui.queuePressed = true;
	list.setPointerCapture(event.pointerId);
}

function shiftOtherRows(current: Drag) {
	current.rows.forEach((row, index) => {
		if (index === current.fromIndex) return;
		let shift = 0;
		if (current.fromIndex < index && index <= current.toIndex) shift = -current.rowPitch;
		else if (current.toIndex <= index && index < current.fromIndex) shift = current.rowPitch;
		row.style.transform = shift ? `translateY(${shift}px)` : '';
	});
}

export function followPointer(event: PointerEvent) {
	if (!drag || drag.list !== event.currentTarget) return;
	const offsetY = event.clientY - drag.startY;
	if (!drag.dragging && Math.abs(offsetY) > QUEUE_DRAG.startDistancePx) {
		drag.dragging = true;
		drag.row.classList.add('dragging');
		setBodyClass('no-select', true);
	}
	if (!drag.dragging) return;
	const rowCount = drag.rows.length;
	const minOffset = -drag.fromIndex * drag.rowPitch;
	const maxOffset = (rowCount - 1 - drag.fromIndex) * drag.rowPitch;
	const clampedOffset = Math.max(minOffset, Math.min(maxOffset, offsetY));
	drag.row.style.transform = `translateY(${clampedOffset}px)`;
	const targetIndex = Math.max(0, Math.min(rowCount - 1, drag.fromIndex + Math.round(clampedOffset / drag.rowPitch)));
	if (targetIndex === drag.toIndex) return;
	drag.toIndex = targetIndex;
	shiftOtherRows(drag);
}

export function endPress() {
	const current = drag;
	if (!current) return;
	drag = null;
	ui.queuePressed = false;
	setBodyClass('no-select', false);
	if (!current.dragging) {
		playUpNextRow(current.row);
		return;
	}
	reorderUpNextRows(current.list.dataset.kind === 'user', current.fromIndex, current.toIndex);
}
