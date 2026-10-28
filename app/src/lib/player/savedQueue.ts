import { isRadio } from '../library/queries.ts';
import { navidrome } from '../session.svelte.ts';
import { SAVED_QUEUE } from '../tuning.ts';
import * as queue from './queue.ts';

const SOURCE_NAME_KEY = 'vibemusic.queue.source';

type SubsonicPlayQueue = { playQueue?: { entry?: { id: string }[]; current?: string; position?: number } };

export type SavedQueue = { trackIds: string[]; currentTrackId: string; positionSeconds: number; sourceName: string };

let lastSavedAt = 0;

export const saveIsDue = () => Date.now() - lastSavedAt > SAVED_QUEUE.whilePlayingMs;

export async function saveQueue(state: queue.QueueState, positionSeconds: number) {
	if (!state.currentTrackId || isRadio(state.currentTrackId)) return;
	lastSavedAt = Date.now();
	const trackIds = queue.savedOrder(state).trackIds.filter((trackId) => !isRadio(trackId));
	try {
		localStorage.setItem(SOURCE_NAME_KEY, state.sourceName);
		await navidrome().subsonic('savePlayQueue', { id: trackIds, current: state.currentTrackId, position: Math.round(positionSeconds * 1000) });
	} catch {
		return;
	}
}

export async function fetchSavedQueue(): Promise<SavedQueue | null> {
	const saved = (await navidrome().subsonic<SubsonicPlayQueue>('getPlayQueue')).playQueue;
	const trackIds = saved?.entry?.map((entry) => entry.id) ?? [];
	if (!trackIds.length) return null;
	return { trackIds, currentTrackId: saved?.current ?? '', positionSeconds: (saved?.position ?? 0) / 1000, sourceName: localStorage.getItem(SOURCE_NAME_KEY) ?? '' };
}
