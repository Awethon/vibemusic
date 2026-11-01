// The play queue as pure functions over plain data (tests in queue.test.ts).
// Two lists: sourceQueue is the album/playlist being played (sourceIndex points at the current
// track); userQueue holds tracks the user added with "play next"/"add to queue" and always plays
// before the rest of the source. Entries can also be "played now" out of order, which takes them
// out of their list; playingOutOfOrder records that so Previous and saving behave correctly.

// entryId tells apart repeated copies of the same track in the queue.
export type Entry = { entryId: string; trackId: string };

export type QueueState = {
	sourceQueue: Entry[];
	sourceIndex: number;
	sourceName: string;
	sourceKey: string;
	userQueue: Entry[];
	currentEntryId: string;
	currentTrackId: string;
	playingOutOfOrder: boolean;
};

export type QueueEffect = 'play' | 'restart' | 'stop' | 'none';

export type QueueEdit =
	| { op: 'moveQueuedToTop'; index: number }
	| { op: 'removeQueued'; index: number }
	| { op: 'removeSource'; index: number }
	| { op: 'clearQueued' }
	| { op: 'moveSourceToPlayNext'; index: number }
	| { op: 'reorder'; fromUserQueue: boolean; from: number; to: number };

// Random per page load so entry ids from different tabs never collide when queues are mirrored.
const entryPrefix = Math.random().toString(36).slice(2, 8);
let lastEntryNumber = 0;

const createEntry = (trackId: string): Entry => ({ entryId: `entry-${entryPrefix}-${++lastEntryNumber}`, trackId });
const createEntries = (trackIds: string[]) => trackIds.map(createEntry);

export const emptyQueue = (): QueueState => ({
	sourceQueue: [],
	sourceIndex: 0,
	sourceName: '',
	sourceKey: '',
	userQueue: [],
	currentEntryId: '',
	currentTrackId: '',
	playingOutOfOrder: false
});

function makeCurrent(state: QueueState, entry: Entry, outOfOrder: boolean) {
	state.currentEntryId = entry.entryId;
	state.currentTrackId = entry.trackId;
	state.playingOutOfOrder = outOfOrder;
}

export function playList(state: QueueState, trackIds: string[], startIndex: number, sourceName: string, sourceKey: string): QueueEffect {
	if (!trackIds.length) return 'none';
	state.sourceQueue = createEntries(trackIds);
	state.sourceIndex = Math.min(Math.max(0, startIndex), trackIds.length - 1);
	state.sourceName = sourceName;
	state.sourceKey = sourceKey;
	makeCurrent(state, state.sourceQueue[state.sourceIndex], false);
	return 'play';
}

export function playQueuedAt(state: QueueState, queuedIndex: number): QueueEffect {
	const [entry] = state.userQueue.splice(queuedIndex, 1);
	if (!entry) return 'none';
	makeCurrent(state, entry, true);
	return 'play';
}

function advanceSourceTo(state: QueueState, sourceIndex: number): QueueEffect {
	state.sourceIndex = sourceIndex;
	makeCurrent(state, state.sourceQueue[sourceIndex], false);
	return 'play';
}

export function playSourceNow(state: QueueState, sourceIndex: number): QueueEffect {
	if (sourceIndex <= state.sourceIndex || !state.sourceQueue[sourceIndex]) return 'none';
	// The very next source track with nothing queued is a normal advance, not an out-of-order play.
	if (sourceIndex === state.sourceIndex + 1 && !state.userQueue.length) return advanceSourceTo(state, sourceIndex);
	const [entry] = state.sourceQueue.splice(sourceIndex, 1);
	makeCurrent(state, entry, true);
	return 'play';
}

export function nextEntry(state: QueueState): Entry | null {
	return state.userQueue[0] ?? state.sourceQueue[state.sourceIndex + 1] ?? null;
}

export function playNext(state: QueueState): QueueEffect {
	if (state.userQueue.length) return playQueuedAt(state, 0);
	if (state.sourceIndex < state.sourceQueue.length - 1) return advanceSourceTo(state, state.sourceIndex + 1);
	return 'stop';
}

// Previous restarts the current track once it has played for a few seconds, or at the start of
// the source. An out-of-order track has no "previous" in the source, so nothing happens.
export function playPrevious(state: QueueState, positionSeconds: number, restartAfterSeconds: number): QueueEffect {
	if (!state.currentEntryId || state.playingOutOfOrder) return 'none';
	if (positionSeconds > restartAfterSeconds || state.sourceIndex <= 0) return 'restart';
	return advanceSourceTo(state, state.sourceIndex - 1);
}

export function queueTracksNext(state: QueueState, trackIds: string[], sourceName: string): QueueEffect {
	if (!state.currentEntryId) return playList(state, trackIds, 0, sourceName, '');
	state.userQueue.unshift(...createEntries(trackIds));
	return 'none';
}

export function queueTracksLast(state: QueueState, trackIds: string[], sourceName: string): QueueEffect {
	if (!state.currentEntryId) return playList(state, trackIds, 0, sourceName, '');
	state.userQueue.push(...createEntries(trackIds));
	return 'none';
}

export function moveQueuedToTop(state: QueueState, queuedIndex: number) {
	const [moved] = state.userQueue.splice(queuedIndex, 1);
	if (moved) state.userQueue.unshift(moved);
}

export const removeQueuedAt = (state: QueueState, queuedIndex: number) => void state.userQueue.splice(queuedIndex, 1);

export function removeSourceAt(state: QueueState, sourceIndex: number) {
	if (sourceIndex <= state.sourceIndex) return;
	state.sourceQueue.splice(sourceIndex, 1);
}

export function clearQueued(state: QueueState) {
	state.userQueue = [];
}

export function moveSourceToPlayNext(state: QueueState, sourceIndex: number) {
	if (sourceIndex <= state.sourceIndex) return;
	const [moved] = state.sourceQueue.splice(sourceIndex, 1);
	if (moved) state.userQueue.unshift(moved);
}

export function reorderUpNext(state: QueueState, fromUserQueue: boolean, fromPosition: number, toPosition: number) {
	const list = fromUserQueue ? state.userQueue : state.sourceQueue;
	const offset = fromUserQueue ? 0 : state.sourceIndex + 1;
	const [moved] = list.splice(offset + fromPosition, 1);
	if (moved) list.splice(offset + toPosition, 0, moved);
}

export const upcomingSource = (state: QueueState) => state.sourceQueue.slice(state.sourceIndex + 1);

export const upNextCount = (state: QueueState) => state.userQueue.length + Math.max(0, state.sourceQueue.length - state.sourceIndex - 1);

// Flattens the queue into one list for Navidrome's savePlayQueue, which only stores a track list
// and a current track. When the current track was played out of order, the source track at
// sourceIndex has already been played too, so it goes before the current one.
export function savedOrder(state: QueueState): { trackIds: string[]; currentIndex: number } {
	const playedCount = state.playingOutOfOrder ? state.sourceIndex + 1 : state.sourceIndex;
	const before = state.sourceQueue.slice(0, playedCount).map((entry) => entry.trackId);
	const after = [...state.userQueue, ...upcomingSource(state)].map((entry) => entry.trackId);
	return { trackIds: [...before, state.currentTrackId, ...after], currentIndex: before.length };
}

export function restoreQueue(state: QueueState, trackIds: string[], currentIndex: number, sourceName: string) {
	playList(state, trackIds, currentIndex, sourceName, '');
}

export function applyEdit(state: QueueState, edit: QueueEdit) {
	if (edit.op === 'moveQueuedToTop') moveQueuedToTop(state, edit.index);
	else if (edit.op === 'removeQueued') removeQueuedAt(state, edit.index);
	else if (edit.op === 'removeSource') removeSourceAt(state, edit.index);
	else if (edit.op === 'clearQueued') clearQueued(state);
	else if (edit.op === 'moveSourceToPlayNext') moveSourceToPlayNext(state, edit.index);
	else reorderUpNext(state, edit.fromUserQueue, edit.from, edit.to);
}

export const copyQueue = (state: QueueState): QueueState => ({
	...state,
	sourceQueue: state.sourceQueue.map((entry) => ({ ...entry })),
	userQueue: state.userQueue.map((entry) => ({ ...entry }))
});

export function replaceQueue(state: QueueState, next: QueueState) {
	Object.assign(state, copyQueue(next));
}

// Every track id the queue references, so mirrored queues can load track details first.
export const queuedTrackIds = (state: QueueState) => [
	...new Set(
		[state.currentTrackId, ...state.sourceQueue.map((entry) => entry.trackId), ...state.userQueue.map((entry) => entry.trackId)].filter(
			Boolean
		)
	)
];
