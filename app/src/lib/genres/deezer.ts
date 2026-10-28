import { titleKey } from './titles.ts';

const DEEZER_GENRES: Record<number, string> = {
	132: 'Pop',
	116: 'Hip-Hop',
	152: 'Rock',
	113: 'Electronic',
	165: 'R&B',
	85: 'Alternative',
	106: 'Electronic',
	466: 'Folk',
	144: 'Reggae',
	129: 'Jazz',
	98: 'Classical',
	173: 'Soundtrack',
	464: 'Metal',
	169: 'Soul',
	153: 'Blues',
	197: 'Latin',
	2: 'World',
	12: 'World',
	16: 'World',
	75: 'World',
	81: 'World'
};

export function deezerAlbumGenre(albums: [string, number][] | null, albumName: string): string | null {
	if (!albums) return null;
	const wanted = titleKey(albumName);
	const found = albums.find(([title]) => titleKey(title) === wanted);
	return found ? (DEEZER_GENRES[found[1]] ?? null) : null;
}
