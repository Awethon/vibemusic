import { GENRE_PLAYLISTS } from '../tuning.ts';
import { parentsOf, withAncestors } from './genres.ts';

export type GenreSong = { id: string; albumId: string; artistId: string; genres: string[]; plays: number; albumPlays: number; starred: boolean };
export type GenrePlaylist = { genre: string; songs: GenreSong[] };

type Rules = typeof GENRE_PLAYLISTS;

const hash = (text: string) => {
	let value = 2166136261;
	for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
	return (value >>> 0) / 4294967296;
};

const score = (song: GenreSong) => Math.log2(1 + song.plays) + (song.starred ? GENRE_PLAYLISTS.likeBonus : 0) + GENRE_PLAYLISTS.albumPlaysWeight * Math.log2(1 + song.albumPlays) + hash(song.id) * GENRE_PLAYLISTS.tieBreakWeight;

const artistCount = (songs: GenreSong[]) => new Set(songs.map((song) => song.artistId)).size;

function qualifies(genre: string, songs: GenreSong[], rules: Rules) {
	const root = parentsOf(genre).length === 0;
	return songs.length >= (root ? rules.rootMinSongs : rules.subMinSongs) && artistCount(songs) >= (root ? rules.rootMinArtists : rules.subMinArtists);
}

function overlaps(ids: Set<string>, other: Set<string>) {
	let shared = 0;
	for (const id of ids) if (other.has(id)) shared++;
	return shared;
}

export function chooseGenres(songs: GenreSong[], rules: Rules = GENRE_PLAYLISTS): GenrePlaylist[] {
	const byGenre = new Map<string, GenreSong[]>();
	for (const song of songs) {
		for (const genre of song.genres) {
			const members = byGenre.get(genre);
			if (members) members.push(song);
			else byGenre.set(genre, [song]);
		}
	}
	const candidates = [...byGenre].filter(([genre, members]) => qualifies(genre, members, rules)).toSorted(([a, aSongs], [b, bSongs]) => withAncestors(a).length - withAncestors(b).length || bSongs.length - aSongs.length || a.localeCompare(b));
	const chosen: { genre: string; ids: Set<string>; songs: GenreSong[] }[] = [];
	for (const [genre, members] of candidates) {
		if (chosen.length >= rules.maxPlaylists) break;
		const ids = new Set(members.map((song) => song.id));
		const ancestors = new Set(withAncestors(genre));
		const repeats = chosen.some((other) => (ancestors.has(other.genre) ? ids.size / other.ids.size >= rules.maxParentShare : overlaps(ids, other.ids) / ids.size >= rules.maxSiblingShare));
		if (!repeats) chosen.push({ genre, ids, songs: members });
	}
	return chosen.map(({ genre, songs: members }) => ({ genre, songs: pickBest(members, rules) }));
}

export function pickBest(members: GenreSong[], rules: Rules = GENRE_PLAYLISTS): GenreSong[] {
	const size = Math.min(rules.songCap, members.length);
	const perArtist = Math.max(Math.ceil((size * rules.songsPerArtistPerBlock) / rules.artistBlockSize), Math.ceil(size / artistCount(members)));
	const ranked = members.map((song) => ({ song, score: score(song) })).toSorted((a, b) => b.score - a.score);
	const taken = new Map<string, number>();
	const picked: typeof ranked = [];
	const skipped: typeof ranked = [];
	for (const entry of ranked) {
		if (picked.length >= size) break;
		const count = taken.get(entry.song.artistId) ?? 0;
		if (count >= perArtist) {
			skipped.push(entry);
			continue;
		}
		taken.set(entry.song.artistId, count + 1);
		picked.push(entry);
	}
	picked.push(...skipped.slice(0, size - picked.length));
	picked.sort((a, b) => b.score - a.score);
	const ordered: GenreSong[] = [];
	while (picked.length) {
		const previous = ordered.at(-1)?.artistId;
		const index = Math.max(0, picked.findIndex((entry) => entry.song.artistId !== previous));
		ordered.push(picked.splice(index, 1)[0].song);
	}
	return ordered;
}
