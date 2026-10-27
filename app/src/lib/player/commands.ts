import { PLAYBACK } from '../tuning.ts';
import * as queue from './queue.ts';

export type Command =
	| { kind: 'playList'; trackIds: string[]; startIndex: number; sourceName: string; listKey: string }
	| { kind: 'togglePlay' }
	| { kind: 'next' }
	| { kind: 'previous' }
	| { kind: 'seek'; seconds: number }
	| { kind: 'volume'; volume: number }
	| { kind: 'mute'; muted: boolean }
	| { kind: 'queueNext' | 'queueLast'; trackIds: string[]; sourceName: string }
	| { kind: 'playQueuedAt' | 'playSourceNow'; index: number }
	| { kind: 'edit'; edit: queue.QueueEdit }
	| { kind: 'liked'; trackId: string; starred: boolean };

export const STARTS_PLAYBACK = new Set<Command['kind']>(['playList', 'togglePlay', 'next', 'previous', 'playQueuedAt', 'playSourceNow', 'seek']);

export function applyToQueue(state: queue.QueueState, command: Command, positionSeconds: number): queue.QueueEffect | null {
	switch (command.kind) {
		case 'playList':
			return queue.playList(state, command.trackIds, command.startIndex, command.sourceName, command.listKey);
		case 'next':
			return queue.playNext(state);
		case 'previous':
			return queue.playPrevious(state, positionSeconds, PLAYBACK.restartInsteadOfPreviousAfterSeconds);
		case 'queueNext':
			return queue.queueTracksNext(state, command.trackIds, command.sourceName);
		case 'queueLast':
			return queue.queueTracksLast(state, command.trackIds, command.sourceName);
		case 'playQueuedAt':
			return queue.playQueuedAt(state, command.index);
		case 'playSourceNow':
			return queue.playSourceNow(state, command.index);
		case 'edit':
			queue.applyEdit(state, command.edit);
			return 'none';
		default:
			return null;
	}
}
