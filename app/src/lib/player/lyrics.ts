import { navidrome } from '../session.svelte.ts';

export type LyricLine = { start: number | null; text: string };
export type Lyrics = { synced: boolean; lines: LyricLine[] };

type StructuredLyrics = { synced: boolean; line?: { start?: number; value: string }[] };
type LyricsResponse = { lyricsList?: { structuredLyrics?: StructuredLyrics[] } };

const cache = new Map<string, Promise<Lyrics | null>>();

async function fetchLyrics(trackId: string): Promise<Lyrics | null> {
	const response = await navidrome().subsonic<LyricsResponse>('getLyricsBySongId', { id: trackId });
	const all = response.lyricsList?.structuredLyrics ?? [];
	// Prefer time-synced lyrics so the current line can follow playback.
	const chosen = all.find((lyrics) => lyrics.synced && lyrics.line?.length) ?? all.find((lyrics) => lyrics.line?.length);
	if (!chosen?.line) return null;
	return {
		synced: chosen.synced,
		lines: chosen.line.map((line) => ({ start: chosen.synced && line.start !== undefined ? line.start / 1000 : null, text: line.value }))
	};
}

export function lyricsFor(trackId: string): Promise<Lyrics | null> {
	if (trackId.startsWith('radio:')) return Promise.resolve(null);
	let loading = cache.get(trackId);
	if (!loading) {
		loading = fetchLyrics(trackId).catch(() => {
			// Forget failures so the next request tries again.
			cache.delete(trackId);
			return null;
		});
		cache.set(trackId, loading);
	}
	return loading;
}

export function currentLineIndex(lyrics: Lyrics | null, position: number): number {
	if (!lyrics?.synced) return -1;
	let index = -1;
	for (let line = 0; line < lyrics.lines.length; line++) {
		if ((lyrics.lines[line].start ?? 0) <= position) index = line;
		else break;
	}
	return index;
}
