import { describe, expect, it } from 'vitest';
import {
	emptyQueue,
	moveSourceToPlayNext,
	nextEntry,
	playList,
	playNext,
	playPrevious,
	playQueuedAt,
	playSourceNow,
	queueTracksLast,
	queueTracksNext,
	removeQueuedAt,
	reorderUpNext,
	savedOrder,
	setShuffle,
	upNextCount,
	type QueueState
} from './queue.ts';

const ids = (entries: { trackId: string }[]) => entries.map((entry) => entry.trackId);

function playing(trackIds = ['a', 'b', 'c', 'd', 'e'], index = 0): QueueState {
	const state = emptyQueue();
	playList(state, trackIds, index, 'Album', 'album:1');
	return state;
}

describe('queue', () => {
	it('plays a list from the chosen index and keeps the user queue', () => {
		const state = playing();
		queueTracksLast(state, ['x'], '');
		playList(state, ['p', 'q'], 1, 'Other', 'album:2');
		expect(state.currentTrackId).toBe('q');
		expect(ids(state.userQueue)).toEqual(['x']);
	});

	it('plays queued tracks before the source and then continues the source', () => {
		const state = playing();
		queueTracksLast(state, ['x', 'y'], '');
		expect(nextEntry(state)?.trackId).toBe('x');
		playNext(state);
		expect(state.currentTrackId).toBe('x');
		expect(state.playingOutOfOrder).toBe(true);
		playNext(state);
		playNext(state);
		expect(state.currentTrackId).toBe('b');
		expect(state.playingOutOfOrder).toBe(false);
	});

	it('stops at the end of the source', () => {
		const state = playing(['a'], 0);
		expect(playNext(state)).toBe('stop');
	});

	it('play next puts tracks before earlier queued ones', () => {
		const state = playing();
		queueTracksLast(state, ['x'], '');
		queueTracksNext(state, ['y', 'z'], '');
		expect(ids(state.userQueue)).toEqual(['y', 'z', 'x']);
	});

	it('starts a new list when queueing with nothing loaded', () => {
		const state = emptyQueue();
		expect(queueTracksNext(state, ['x', 'y'], 'Album')).toBe('play');
		expect(state.currentTrackId).toBe('x');
	});

	it('previous restarts late in a track or on the first entry, otherwise goes back', () => {
		const state = playing(['a', 'b', 'c'], 1);
		expect(playPrevious(state, 10, 4)).toBe('restart');
		expect(playPrevious(state, 1, 4)).toBe('play');
		expect(state.currentTrackId).toBe('a');
		expect(playPrevious(state, 1, 4)).toBe('restart');
	});

	it('previous does nothing while playing out of order', () => {
		const state = playing();
		queueTracksLast(state, ['x'], '');
		playNext(state);
		expect(playPrevious(state, 0, 4)).toBe('none');
	});

	it('play now on a queued entry removes only that entry', () => {
		const state = playing();
		queueTracksLast(state, ['x', 'y', 'z'], '');
		playQueuedAt(state, 1);
		expect(state.currentTrackId).toBe('y');
		expect(ids(state.userQueue)).toEqual(['x', 'z']);
	});

	it('play now on the next source entry simply advances', () => {
		const state = playing();
		playSourceNow(state, 1);
		expect(state.sourceIndex).toBe(1);
		expect(state.playingOutOfOrder).toBe(false);
	});

	it('play now further ahead keeps the skipped source entries', () => {
		const state = playing();
		playSourceNow(state, 3);
		expect(state.currentTrackId).toBe('d');
		expect(state.playingOutOfOrder).toBe(true);
		expect(ids(state.sourceQueue)).toEqual(['a', 'b', 'c', 'e']);
		playNext(state);
		expect(state.currentTrackId).toBe('b');
	});

	it('removes exactly one of two duplicate entries', () => {
		const state = playing();
		queueTracksLast(state, ['x', 'x'], '');
		const [first, second] = state.userQueue;
		removeQueuedAt(state, 1);
		expect(state.userQueue).toEqual([first]);
		expect(state.userQueue).not.toContain(second);
	});

	it('moves a source entry to play next keeping its id', () => {
		const state = playing();
		const entry = state.sourceQueue[2];
		moveSourceToPlayNext(state, 2);
		expect(state.userQueue[0]).toBe(entry);
		expect(upNextCount(state)).toBe(4);
	});

	it('reorders within up next', () => {
		const state = playing();
		reorderUpNext(state, false, 0, 2);
		expect(ids(state.sourceQueue)).toEqual(['a', 'c', 'd', 'b', 'e']);
	});

	it('flattens the queue for saving', () => {
		const state = playing(['a', 'b', 'c', 'd'], 1);
		queueTracksLast(state, ['x'], '');
		expect(savedOrder(state)).toEqual({ trackIds: ['a', 'b', 'x', 'c', 'd'], currentIndex: 1 });
		playNext(state);
		expect(savedOrder(state)).toEqual({ trackIds: ['a', 'b', 'x', 'c', 'd'], currentIndex: 2 });
	});

	it('shuffles a list behind the chosen track, or from a random one', () => {
		const sequence = [0.9, 0.1, 0.5, 0.3, 0.7];
		const random = () => sequence.shift() ?? 0;
		const state = emptyQueue();
		playList(state, ['a', 'b', 'c', 'd', 'e'], 2, 'Album', 'album:1', true, random);
		expect(state.currentTrackId).toBe('c');
		expect(state.sourceIndex).toBe(0);
		expect(ids(state.sourceQueue)[0]).toBe('c');
		expect(ids(state.sourceQueue).toSorted()).toEqual(['a', 'b', 'c', 'd', 'e']);
		expect(state.shuffled).toBe(true);
		playList(state, ['p', 'q', 'r', 's'], -1, 'Other', 'album:2', true, () => 0.6);
		expect(state.currentTrackId).toBe('r');
	});

	it('turning shuffle on keeps the current track, and off restores the order after it', () => {
		const state = playing(['a', 'b', 'c', 'd', 'e'], 1);
		setShuffle(state, true, () => 0);
		expect(state.currentTrackId).toBe('b');
		expect(ids(state.sourceQueue)[0]).toBe('b');
		playNext(state);
		const now = state.currentTrackId;
		setShuffle(state, false);
		expect(state.shuffled).toBe(false);
		expect(ids(state.sourceQueue)).toEqual(['a', 'b', 'c', 'd', 'e']);
		expect(state.currentTrackId).toBe(now);
		expect(state.sourceQueue[state.sourceIndex].trackId).toBe(now);
	});
});
