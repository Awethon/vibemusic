import { currentLineIndex, lyricsFor, type Lyrics } from './lyrics.ts';
import { player } from './player.svelte.ts';

export const lyricsState = $state<{ trackId: string; lyrics: Lyrics | null; loading: boolean }>({
	trackId: '',
	lyrics: null,
	loading: false
});

export function loadLyricsFor(trackId: string) {
	if (lyricsState.trackId === trackId) return;
	lyricsState.trackId = trackId;
	lyricsState.lyrics = null;
	lyricsState.loading = !!trackId;
	if (!trackId) return;
	void lyricsFor(trackId).then((lyrics) => {
		if (lyricsState.trackId !== trackId) return;
		lyricsState.lyrics = lyrics;
		lyricsState.loading = false;
	});
}

export const currentLyricIndex = () => currentLineIndex(lyricsState.lyrics, player.position);
