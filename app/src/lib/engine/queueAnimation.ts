import { flushSync } from 'svelte';
import { playerQueue } from '../player/player.svelte.ts';
import { EASING, QUEUE_MOTION } from '../tuning.ts';
import { ui } from '../ui/state.svelte.ts';
import { bodyHasClass, prefersReducedMotion } from './dom.ts';

export const QUEUE_ROW_SELECTOR = '.qlist li, #npNext li';

const PANEL_GROUP = 'pn';
const FULL_SCREEN_GROUP = 'np';

type RowSnapshot = { row: HTMLElement; group: string; rect: DOMRect; visible: boolean };

const rowGroupOf = (row: HTMLElement) => (row.parentElement?.id === 'npNext' ? FULL_SCREEN_GROUP : PANEL_GROUP);

function isRowGroupVisible(group: string) {
	if (group === FULL_SCREEN_GROUP) return bodyHasClass('now-open') && ui.fullScreenStyle === 'canvas';
	return bodyHasClass('panel-open') && !bodyHasClass('now-open') && ui.panelTab === 'queue';
}

function snapshotQueueRows() {
	const rowsByKey = new Map<string, RowSnapshot>();
	for (const row of document.querySelectorAll<HTMLElement>(QUEUE_ROW_SELECTOR)) {
		const group = rowGroupOf(row);
		rowsByKey.set(`${group}:${row.dataset.entry}`, { row, group, rect: row.getBoundingClientRect(), visible: isRowGroupVisible(group) });
	}
	return rowsByKey;
}

function stripIds(element: Element) {
	for (const node of [element, ...element.querySelectorAll('[id]')]) node.removeAttribute('id');
}

export function placeOverlayCopy(original: HTMLElement, rect: DOMRect) {
	const copy = original.cloneNode(true) as HTMLElement;
	stripIds(copy);
	copy.classList.add('row-lift');
	copy.classList.remove('dragging');
	Object.assign(copy.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, transform: '', opacity: '', visibility: '' });
	document.body.append(copy);
	return copy;
}

function animateRowLeaving(original: HTMLElement, rect: DOMRect, exitTransform: string) {
	const copy = placeOverlayCopy(original, rect);
	const animation = copy.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: exitTransform }], { duration: QUEUE_MOTION.exitMs, easing: EASING.easeOutCubic, fill: 'forwards' });
	animation.onfinish = () => copy.remove();
}

function captureNowPlayingBlocks() {
	const blocks: HTMLElement[] = [];
	const panelNow = document.querySelector<HTMLElement>('.pn-now');
	const canvasNow = document.querySelector<HTMLElement>('#now .np-left');
	if (bodyHasClass('panel-open') && !bodyHasClass('now-open') && panelNow) blocks.push(panelNow);
	if (bodyHasClass('now-open') && ui.fullScreenStyle === 'canvas' && canvasNow) blocks.push(canvasNow);
	return blocks.map((block) => ({ block, rect: block.getBoundingClientRect(), copy: block.cloneNode(true) as HTMLElement }));
}

function crossfadeNowPlaying(captured: ReturnType<typeof captureNowPlayingBlocks>) {
	for (const { block, rect, copy } of captured) {
		stripIds(copy);
		Object.assign(copy.style, {
			position: 'fixed',
			left: `${rect.left}px`,
			top: `${rect.top}px`,
			width: `${rect.width}px`,
			height: `${rect.height}px`,
			margin: '0',
			zIndex: String(QUEUE_MOTION.overlayZIndex),
			pointerEvents: 'none'
		});
		document.body.append(copy);
		const fadeOut = copy.animate([{ opacity: 1 }, { opacity: 0 }], { duration: QUEUE_MOTION.nowCrossfadeMs, easing: EASING.easeOutCubic, fill: 'forwards' });
		fadeOut.onfinish = () => copy.remove();
		block.animate([{ opacity: 0 }, { opacity: 1 }], { duration: QUEUE_MOTION.nowCrossfadeMs, easing: EASING.easeOutCubic });
	}
}

function animateLeavingRows(before: Map<string, RowSnapshot>, after: Map<string, RowSnapshot>, playedEntryId: string | null, skippedRow?: HTMLElement) {
	for (const [key, previous] of before) {
		if (after.has(key) || previous.row === skippedRow || !previous.visible) continue;
		if (previous.rect.bottom < 0 || previous.rect.top > innerHeight) continue;
		const isPlayedRow = playedEntryId !== null && previous.row.dataset.entry === playedEntryId;
		animateRowLeaving(previous.row, previous.rect, isPlayedRow ? QUEUE_MOTION.playedExitTransform : QUEUE_MOTION.exitTransform);
	}
}

function animateEnteringRow(row: HTMLElement) {
	row.animate([{ opacity: 0, transform: `translateX(${QUEUE_MOTION.enterSlidePx}px)` }, { opacity: 1, transform: 'none' }], { duration: QUEUE_MOTION.enterMs, easing: EASING.easeOutCubic });
}

function animateGlide(row: HTMLElement, offsetY: number) {
	row.animate([{ transform: `translateY(${offsetY}px)` }, { transform: 'none' }], { duration: QUEUE_MOTION.glideMs, easing: EASING.easeOutCubic });
}

function animateTravel(row: HTMLElement, offsetY: number) {
	row.classList.add('row-travel');
	const travel = row.animate(
		[
			{ transform: `translateY(${offsetY}px)`, boxShadow: QUEUE_MOTION.restingShadow },
			{ transform: `translateY(${offsetY * QUEUE_MOTION.travelMidpoint}px)`, boxShadow: QUEUE_MOTION.travelShadow, offset: QUEUE_MOTION.travelMidpoint },
			{ transform: 'none', boxShadow: QUEUE_MOTION.restingShadow }
		],
		{ duration: QUEUE_MOTION.travelMs, easing: EASING.easeOutCubic }
	);
	const settle = () => row.classList.remove('row-travel');
	travel.addEventListener('finish', settle);
	travel.addEventListener('cancel', settle);
}

function animateRemainingRows(before: Map<string, RowSnapshot>, after: Map<string, RowSnapshot>, movedEntryId?: string) {
	const groupsWithTravel = new Set<string>();
	for (const [key, current] of after) {
		const previous = before.get(key);
		if (!previous) {
			if (current.visible) animateEnteringRow(current.row);
			continue;
		}
		const offsetY = previous.rect.top - current.rect.top;
		if (Math.abs(offsetY) < QUEUE_MOTION.minRowOffsetPx) continue;
		const travels = movedEntryId !== undefined && current.row.dataset.entry === movedEntryId && !groupsWithTravel.has(current.group);
		if (travels) {
			groupsWithTravel.add(current.group);
			animateTravel(current.row, offsetY);
		} else {
			animateGlide(current.row, offsetY);
		}
	}
}

function clearDragStyles() {
	for (const row of document.querySelectorAll<HTMLElement>(QUEUE_ROW_SELECTOR)) {
		row.style.transform = '';
		row.style.visibility = '';
		row.classList.remove('dragging');
	}
}

export function animateQueueChange(applyChange: () => void, options: { movedEntryId?: string; skipRow?: HTMLElement } = {}) {
	if (prefersReducedMotion()) {
		applyChange();
		flushSync();
		clearDragStyles();
		return;
	}
	const before = snapshotQueueRows();
	const entryIdBefore = playerQueue().currentEntryId;
	const nowPlayingBlocks = captureNowPlayingBlocks();
	applyChange();
	flushSync();
	clearDragStyles();
	const after = snapshotQueueRows();
	const playedEntryId = playerQueue().currentEntryId !== entryIdBefore ? playerQueue().currentEntryId : null;
	animateLeavingRows(before, after, playedEntryId, options.skipRow);
	animateRemainingRows(before, after, options.movedEntryId);
	if (playedEntryId !== null) crossfadeNowPlaying(nowPlayingBlocks);
}
