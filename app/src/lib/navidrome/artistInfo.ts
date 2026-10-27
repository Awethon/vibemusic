import { navidrome } from '../session.svelte.ts';
import { ARTIST_PAGE } from '../tuning.ts';

export type ArtistInfo = { biography: string; similarArtistIds: string[]; topTrackIds: string[] };

type ArtistInfoResponse = { artistInfo2?: { biography?: string; similarArtist?: { id: string }[] } };
type TopSongsResponse = { topSongs?: { song?: { id: string }[] } };

const cache = new Map<string, Promise<ArtistInfo>>();

function plainBiography(html: string): string {
	const text = new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
	return text
		.replace(/Read more on Last\.fm\.?\s*$/i, '')
		.replace(/\s+\n/g, '\n')
		.trim();
}

async function fetchArtistInfo(artistId: string, artistName: string): Promise<ArtistInfo> {
	const http = navidrome();
	const [info, top] = await Promise.all([
		http.subsonic<ArtistInfoResponse>('getArtistInfo2', { id: artistId, count: ARTIST_PAGE.similarCount, includeNotPresent: 'false' }).catch(() => ({}) as ArtistInfoResponse),
		http.subsonic<TopSongsResponse>('getTopSongs', { artist: artistName, count: ARTIST_PAGE.topSongCount }).catch(() => ({}) as TopSongsResponse)
	]);
	return {
		biography: plainBiography(info.artistInfo2?.biography ?? ''),
		similarArtistIds: [...new Set((info.artistInfo2?.similarArtist ?? []).map((artist) => artist.id))].filter((id) => id !== artistId),
		topTrackIds: [...new Set((top.topSongs?.song ?? []).map((song) => song.id))]
	};
}

export function artistInfo(artistId: string, artistName: string): Promise<ArtistInfo> {
	let loading = cache.get(artistId);
	if (!loading) {
		loading = fetchArtistInfo(artistId, artistName);
		cache.set(artistId, loading);
		loading.catch(() => cache.delete(artistId));
	}
	return loading;
}
