// Every queue edit from the UI, each wrapped in animateQueueChange so the queue panel animates it.
import { animateQueueChange } from '../engine/queueAnimation.ts';
import type { Track } from '../library/queries.ts';
import { editQueue, playQueuedAt, playSourceNow, playTracks, queueLast, queueNext, playerQueue } from '../player/player.svelte.ts';
import { formatCount } from './format.ts';
import { showToast } from './state.svelte.ts';

export function playListAnimated(tracks: Track[], startIndex: number, sourceName: string, listKey: string) {
	animateQueueChange(() => playTracks(tracks, startIndex, sourceName, listKey));
}

export function playNextFromMenu(tracks: Track[], sourceName: string) {
	if (!tracks.length) return;
	// With nothing playing there is nothing to queue after, so just start playing.
	if (!playerQueue().currentTrackId) {
		playTracks(tracks, 0, sourceName, '');
		return;
	}
	animateQueueChange(() => queueNext(tracks, sourceName));
	showToast(tracks.length > 1 ? `${formatCount(tracks.length)} tracks will play next` : 'Plays next');
}

export function addToQueueFromMenu(tracks: Track[], sourceName: string) {
	if (!tracks.length) return;
	if (!playerQueue().currentTrackId) {
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
	const movedEntryId = playerQueue().userQueue[queuedIndex]?.entryId;
	animateQueueChange(() => editQueue({ op: 'moveQueuedToTop', index: queuedIndex }), { movedEntryId });
}

export const removeQueued = (queuedIndex: number) => animateQueueChange(() => editQueue({ op: 'removeQueued', index: queuedIndex }));

export function clearQueued() {
	animateQueueChange(() => editQueue({ op: 'clearQueued' }));
	showToast('Queue cleared');
}

export function playSourceTrackNext(sourceIndex: number) {
	const movedEntryId = playerQueue().sourceQueue[sourceIndex]?.entryId;
	animateQueueChange(() => editQueue({ op: 'moveSourceToPlayNext', index: sourceIndex }), { movedEntryId });
}

export const removeFromSource = (sourceIndex: number) => animateQueueChange(() => editQueue({ op: 'removeSource', index: sourceIndex }));

export function reorderUpNextRows(fromUserQueue: boolean, fromPosition: number, toPosition: number) {
	// Positions are relative to the visible "up next" rows; source rows start after the current track.
	const list = fromUserQueue ? playerQueue().userQueue : playerQueue().sourceQueue;
	const movedEntryId = list[(fromUserQueue ? 0 : playerQueue().sourceIndex + 1) + fromPosition]?.entryId;
	animateQueueChange(() => editQueue({ op: 'reorder', fromUserQueue, from: fromPosition, to: toPosition }), { movedEntryId });
	if (fromPosition !== toPosition) showToast('Queue reordered');
}

export function removeRowAfterSwipe(row: HTMLElement) {
	animateQueueChange(
		() =>
			editQueue(
				row.dataset.uq !== undefined
					? { op: 'removeQueued', index: Number(row.dataset.uq) }
					: { op: 'removeSource', index: Number(row.dataset.qi) }
			),
		{ skipRow: row }
	);
}
