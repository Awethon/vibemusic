import { animateQueueChange } from '../engine/queueAnimation.ts';
import type { Track } from '../library/queries.ts';
import * as queue from '../player/queue.ts';
import { editQueue, player, playQueuedAt, playSourceNow, playTracks, queueLast, queueNext } from '../player/player.svelte.ts';
import { formatCount } from './format.ts';
import { showToast } from './state.svelte.ts';

export function playListAnimated(tracks: Track[], startIndex: number, sourceName: string, listKey: string) {
	animateQueueChange(() => playTracks(tracks, startIndex, sourceName, listKey));
}

export function playNextFromMenu(tracks: Track[], sourceName: string) {
	if (!tracks.length) return;
	if (!player.queue.currentTrackId) {
		playTracks(tracks, 0, sourceName, '');
		return;
	}
	animateQueueChange(() => queueNext(tracks, sourceName));
	showToast(tracks.length > 1 ? `${formatCount(tracks.length)} tracks will play next` : 'Plays next');
}

export function addToQueueFromMenu(tracks: Track[], sourceName: string) {
	if (!tracks.length) return;
	if (!player.queue.currentTrackId) {
		playTracks(tracks, 0, sourceName, '');
		return;
	}
	animateQueueChange(() => queueLast(tracks, sourceName));
	showToast(tracks.length > 1 ? `Added ${formatCount(tracks.length)} tracks to queue` : 'Added to queue');
}

export const playQueuedNow = (queuedIndex: number) => animateQueueChange(() => playQueuedAt(queuedIndex));

export const playSourceTrackNow = (sourceIndex: number) => animateQueueChange(() => playSourceNow(sourceIndex));

export function playUpNextRow(row: HTMLElement) {
	if (row.dataset.uq !== undefined) playQueuedNow(Number(row.dataset.uq));
	else playSourceTrackNow(Number(row.dataset.qi));
}

export function moveQueuedToTop(queuedIndex: number) {
	const movedEntryId = player.queue.userQueue[queuedIndex]?.entryId;
	animateQueueChange(() => editQueue((state) => queue.moveQueuedToTop(state, queuedIndex)), { movedEntryId });
}

export const removeQueued = (queuedIndex: number) => animateQueueChange(() => editQueue((state) => queue.removeQueuedAt(state, queuedIndex)));

export function clearQueued() {
	animateQueueChange(() => editQueue(queue.clearQueued));
	showToast('Queue cleared');
}

export function playSourceTrackNext(sourceIndex: number) {
	const movedEntryId = player.queue.sourceQueue[sourceIndex]?.entryId;
	animateQueueChange(() => editQueue((state) => queue.moveSourceToPlayNext(state, sourceIndex)), { movedEntryId });
}

export const removeFromSource = (sourceIndex: number) => animateQueueChange(() => editQueue((state) => queue.removeSourceAt(state, sourceIndex)));

export function reorderUpNextRows(fromUserQueue: boolean, fromPosition: number, toPosition: number) {
	const list = fromUserQueue ? player.queue.userQueue : player.queue.sourceQueue;
	const movedEntryId = list[(fromUserQueue ? 0 : player.queue.sourceIndex + 1) + fromPosition]?.entryId;
	animateQueueChange(() => editQueue((state) => queue.reorderUpNext(state, fromUserQueue, fromPosition, toPosition)), { movedEntryId });
	if (fromPosition !== toPosition) showToast('Queue reordered');
}

export function removeRowAfterSwipe(row: HTMLElement) {
	animateQueueChange(
		() =>
			editQueue((state) => {
				if (row.dataset.uq !== undefined) queue.removeQueuedAt(state, Number(row.dataset.uq));
				else queue.removeSourceAt(state, Number(row.dataset.qi));
			}),
		{ skipRow: row }
	);
}
