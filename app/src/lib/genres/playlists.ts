import { GENRE_PLAYLISTS } from '../tuning.ts';
import { parentsOf, withAncestors } from './genres.ts';
import { isOtherRecording, isPlainTitle, titleKey } from './titles.ts';

export type GenreSong = { id: string; title: string; duration: number; albumId: string; artistId: string; genres: string[]; plays: number; starred: boolean; fans: number | null; popularity: number | null };
export type GenrePlaylist = { genre: string; songs: GenreSong[] };

type Rules = { readonly [Key in keyof typeof GENRE_PLAYLISTS]: number };

const hash = (text: string) => {
	let value = 2166136261;
	for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
	return (value >>> 0) / 4294967296;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

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
	const chosen: { genre: string; ids: Set<string>; picked: Set<string>; best: GenreSong[] }[] = [];
	for (const [genre, members] of candidates) {
		if (chosen.length >= rules.maxPlaylists) break;
		const ids = new Set(members.map((song) => song.id));
		const ancestors = new Set(withAncestors(genre));
		const repeats = chosen.some((other) => (ancestors.has(other.genre) ? ids.size / other.ids.size >= rules.maxParentShare : overlaps(ids, other.ids) / ids.size >= rules.maxSiblingShare));
		if (repeats) continue;
		const best = pickBest(members, rules);
		const picked = new Set(best.map((song) => song.id));
		if (chosen.some((other) => !ancestors.has(other.genre) && overlaps(picked, other.picked) / picked.size >= rules.maxPickedShare)) continue;
		chosen.push({ genre, ids, picked, best });
	}
	return chosen.map(({ genre, best }) => ({ genre, songs: best }));
}

function allot(weights: Map<string, number>, available: Map<string, number>, size: number, rules: Rules) {
	const cap = Math.max(1, Math.round(size * rules.artistShareCap));
	const seats = new Map<string, number>();
	let total = 0;
	for (const artist of [...weights.keys()].toSorted((a, b) => weights.get(b)! - weights.get(a)!)) {
		if (total >= size) break;
		seats.set(artist, 1);
		total++;
	}
	while (total < size) {
		const open = (limit: (artist: string) => number) => [...seats.keys()].filter((artist) => seats.get(artist)! < limit(artist));
		let candidates = open((artist) => Math.min(cap, available.get(artist)!));
		if (!candidates.length) candidates = open((artist) => available.get(artist)!);
		if (!candidates.length) break;
		const next = candidates.reduce((best, artist) => (weights.get(artist)! / (2 * seats.get(artist)! + 1) > weights.get(best)! / (2 * seats.get(best)! + 1) ? artist : best));
		seats.set(next, seats.get(next)! + 1);
		total++;
	}
	return seats;
}

const FILLER = /(^|[^\p{L}])(skit|intro|outro|interlude|prelude|скит|интро|аутро|интерлюдия)([^\p{L}]|$)/iu;

const isFiller = (song: GenreSong, rules: Rules) => song.popularity === null && (song.duration < rules.minSongSeconds || FILLER.test(song.title));

const versionOrder = (song: GenreSong) => [-song.plays, -Number(song.starred), Number(isOtherRecording(song.title)), Number(!isPlainTitle(song.title)), Number(song.popularity === null)];

function preferredVersion(a: GenreSong, b: GenreSong) {
	const left = versionOrder(a);
	const right = versionOrder(b);
	const index = left.findIndex((value, position) => value !== right[position]);
	return index < 0 ? a.id.localeCompare(b.id) : left[index] - right[index];
}

function oneVersionEach(members: GenreSong[], rules: Rules) {
	const best = new Map<string, GenreSong>();
	for (const song of members) {
		if (isFiller(song, rules)) continue;
		const key = `${song.artistId}\u0000${titleKey(song.title) || song.id}`;
		const kept = best.get(key);
		if (!kept || preferredVersion(song, kept) < 0) best.set(key, song);
	}
	return [...best.values()];
}

export function pickBest(allVersions: GenreSong[], rules: Rules = GENRE_PLAYLISTS, now = Date.now()): GenreSong[] {
	const members = oneVersionEach(allVersions, rules);
	const size = Math.min(rules.songCap, members.length);
	const byArtist = Map.groupBy(members, (song) => song.artistId);
	const fans = new Map([...byArtist].map(([artist, songs]) => [artist, songs.find((song) => song.fans !== null)?.fans ?? null]));
	const knownFans = [...fans.values()].filter((value): value is number => value !== null);
	const unknownFans = knownFans.length ? Math.min(...knownFans) : 1;
	const knownPopularity = members.flatMap((song) => (song.popularity === null ? [] : [song.popularity]));
	const unknownPopularity = knownPopularity.length ? Math.min(...knownPopularity) : 0;
	const fallback = new Map(
		[...byArtist].map(([artist, songs]) => {
			const known = songs.flatMap((song) => (song.popularity === null ? [] : [song.popularity]));
			return [artist, (known.length ? Math.min(...known) : unknownPopularity) * rules.unknownPopularityShare];
		})
	);
	const week = Math.floor(now / WEEK_MS);
	const yours = (song: GenreSong) => (1 + song.plays / rules.playsDivisor) * (song.starred ? rules.likeMultiplier : 1);
	const score = knownPopularity.length
		? (song: GenreSong) => Math.log2(1 + (song.popularity ?? fallback.get(song.artistId)!) * yours(song))
		: (song: GenreSong) => Math.log2(1 + song.plays) + Math.log2(song.starred ? rules.likeMultiplier : 1);
	const weights = new Map(
		[...byArtist].map(([artist, songs]) => {
			const plays = songs.reduce((total, song) => total + song.plays, 0);
			return [artist, Math.max(1, fans.get(artist) ?? unknownFans) ** rules.fanPower * (1 + plays / rules.artistPlaysDivisor)];
		})
	);
	const seats = allot(weights, new Map([...byArtist].map(([artist, songs]) => [artist, songs.length])), size, rules);
	const picked = [...seats].flatMap(([artist, count]) => byArtist.get(artist)!.toSorted((a, b) => score(b) - score(a) || a.id.localeCompare(b.id)).slice(0, count));
	const ranked = picked.map((song) => ({ song, score: score(song) + rules.weeklyNoise * hash(`${song.id}:${week}`) })).toSorted((a, b) => b.score - a.score);
	const gap = Math.min(rules.artistGap, Math.max(1, Math.floor((seats.size - 1) / 2)));
	const ordered: GenreSong[] = [];
	const left = new Map([...seats].map(([artist, count]) => [artist, Math.min(count, byArtist.get(artist)!.length)]));
	while (ranked.length) {
		const recent = new Set(ordered.slice(Math.max(0, ordered.length - gap)).map((song) => song.artistId));
		const allowed = (entry: (typeof ranked)[number]) => !recent.has(entry.song.artistId);
		const most = Math.max(...left.values());
		const crowded = [...left.values()].filter((count) => count === most).length;
		const urgent = (entry: (typeof ranked)[number]) => left.get(entry.song.artistId) === most && (most - 1) * (gap + 1) + crowded >= ranked.length;
		const index = [ranked.findIndex((entry) => allowed(entry) && urgent(entry)), ranked.findIndex(allowed), 0].find((found) => found >= 0)!;
		const [{ song }] = ranked.splice(index, 1);
		left.set(song.artistId, left.get(song.artistId)! - 1);
		ordered.push(song);
	}
	return ordered;
}
