import { isRadio, radioTracks, RADIO_PREFIX } from '../library/queries.ts';
import { RADIO } from '../tuning.ts';
import { player, remember, trackById } from './state.svelte.ts';

type NowPlaying = { title: string; artist: string };

export const radioNow = $state({ stationId: '', title: '', artist: '' });

let lastPollAt = 0;
let polling = false;

async function poll(trackId: string) {
	polling = true;
	try {
		const response = await fetch(`/radio/${encodeURIComponent(trackId.slice(RADIO_PREFIX.length))}/now`);
		const now: NowPlaying = response.ok ? await response.json() : { title: '', artist: '' };
		const station = (await radioTracks()).find((candidate) => candidate.id === trackId);
		if (!station) return;
		Object.assign(radioNow, { stationId: trackId, title: now.title, artist: now.artist });
		const shown = now.title ? { ...station, title: now.title, artist: now.artist ? `${now.artist} · ${station.title}` : station.title } : station;
		const cached = trackById(trackId);
		if (cached?.title !== shown.title || cached?.artist !== shown.artist) remember([shown]);
	} catch {
		return;
	} finally {
		polling = false;
	}
}

export function pollRadio(currentTrackId: string, nowMs: number) {
	if (!isRadio(currentTrackId) || !player.playing || polling) return;
	const wait = radioNow.stationId === currentTrackId && radioNow.title ? RADIO.nowPlayingPollMs : RADIO.firstTitlePollMs;
	if (nowMs - lastPollAt < wait) return;
	lastPollAt = nowMs;
	void poll(currentTrackId);
}
