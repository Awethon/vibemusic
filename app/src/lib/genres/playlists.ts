// Builds the automatic genre playlists: chooseGenres picks which genres get one (avoiding
// near-duplicates of a parent or sibling), pickBest picks and orders up to songCap songs for each.
import { GENRE_PLAYLISTS, HIDDEN_GENRE_PLAYLISTS } from '../tuning.ts';
import { descendantCount, parentsOf, withAncestors } from './genres.ts';
import { isOtherRecording, isPlainTitle, titleKey } from './titles.ts';

export type GenreSong = {
	id: string;
	title: string;
	duration: number;
	year: number;
	albumId: string;
	artistId: string;
	genres: string[];
	plays: number;
	starred: boolean;
	fans: number | null;
	popularity: number | null;
	rank: number | null;
};
export type GenrePlaylist = { genre: string; songs: GenreSong[] };

type Rules = { readonly [Key in keyof typeof GENRE_PLAYLISTS]: number };

// Deterministic 0..1 noise (FNV-1a), seeded with the week number so playlists reshuffle weekly
// but stay stable between rebuilds in the same week.
const hash = (text: string) => {
	let value = 2166136261;
	for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
	return (value >>> 0) / 4294967296;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const artistCount = (songs: GenreSong[]) => new Set(songs.map((song) => song.artistId)).size;

function qualifies(genre: string, songs: GenreSong[], rules: Rules) {
	const root = parentsOf(genre).length === 0;
	return (
		songs.length >= (root ? rules.rootMinSongs : rules.subMinSongs) &&
		artistCount(songs) >= (root ? rules.rootMinArtists : rules.subMinArtists)
	);
}

function overlaps(ids: Set<string>, other: Set<string>) {
	let shared = 0;
	for (const id of ids) if (other.has(id)) shared++;
	return shared;
}

export function chooseGenres(
	songs: GenreSong[],
	rules: Rules = GENRE_PLAYLISTS,
	hidden: readonly string[] = HIDDEN_GENRE_PLAYLISTS,
	pinned: readonly string[] = []
): GenrePlaylist[] {
	const byGenre = new Map<string, GenreSong[]>();
	for (const song of songs) {
		for (const genre of song.genres) {
			const members = byGenre.get(genre);
			if (members) members.push(song);
			else byGenre.set(genre, [song]);
		}
	}
	// Pinned genres first, whatever their size; then broad genres (fewest ancestors, then fewest
	// descendants), so a sub-genre is only added later if it isn't mostly a copy of a playlist
	// already chosen.
	const isPinned = (genre: string) => pinned.includes(genre);
	const candidates = [...byGenre]
		.filter(([genre, members]) => !hidden.includes(genre) && (isPinned(genre) || qualifies(genre, members, rules)))
		.toSorted(
			([a, aSongs], [b, bSongs]) =>
				Number(isPinned(b)) - Number(isPinned(a)) ||
				withAncestors(a).length - withAncestors(b).length ||
				descendantCount(a) - descendantCount(b) ||
				bSongs.length - aSongs.length ||
				a.localeCompare(b)
		);
	const chosen: { genre: string; ids: Set<string>; picked: Set<string>; best: GenreSong[] }[] = [];
	for (const [genre, members] of candidates) {
		if (chosen.length >= rules.maxPlaylists) break;
		const ids = new Set(members.map((song) => song.id));
		const ancestors = new Set(withAncestors(genre));
		const repeats =
			!isPinned(genre) &&
			chosen.some((other) =>
				ancestors.has(other.genre)
					? ids.size / other.ids.size >= rules.maxParentShare
					: overlaps(ids, other.ids) / ids.size >= rules.maxSiblingShare
			);
		if (repeats) continue;
		const best = pickBest(members, rules);
		if (!best.length) continue;
		const picked = new Set(best.map((song) => song.id));
		if (
			!isPinned(genre) &&
			chosen.some((other) => !ancestors.has(other.genre) && overlaps(picked, other.picked) / picked.size >= rules.maxPickedShare)
		)
			continue;
		chosen.push({ genre, ids, picked, best });
	}
	return chosen.map(({ genre, best }) => ({ genre, songs: best }));
}

// How many songs each artist gets: every artist one seat (by weight, while seats last), then
// Sainte-Laguë-style rounds (weight / (2n + 1)) so big artists get more without crowding out the
// rest. The per-artist cap is only relaxed when nobody under it has songs left.
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
		const next = candidates.reduce((best, artist) =>
			weights.get(artist)! / (2 * seats.get(artist)! + 1) > weights.get(best)! / (2 * seats.get(best)! + 1) ? artist : best
		);
		seats.set(next, seats.get(next)! + 1);
		total++;
	}
	return seats;
}

const FILLER = /(^|[^\p{L}])(skit|intro|outro|interlude|prelude|скит|интро|аутро|интерлюдия)([^\p{L}]|$)/iu;

// Skits and intros are dropped, but only when no chart data says the track is actually popular.
const isFiller = (song: GenreSong, rules: Rules) =>
	song.popularity === null && song.rank === null && (song.duration < rules.minSongSeconds || FILLER.test(song.title));

// When a song exists in several versions, prefer (in order): the original recording, the earliest
// release, a plain title, more plays, starred, known popularity.
const versionOrder = (song: GenreSong) => [
	Number(isOtherRecording(song.title)),
	song.year || Number.MAX_SAFE_INTEGER,
	Number(!isPlainTitle(song.title)),
	-song.plays,
	-Number(song.starred),
	Number(song.popularity === null)
];

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
	// With popularity data, songs are scored by it boosted by your plays and likes; without any,
	// by your plays and likes alone. log2 keeps a few huge hits from dominating.
	const score = knownPopularity.length
		? (song: GenreSong) => Math.log2(1 + (song.popularity ?? fallback.get(song.artistId)!) * yours(song))
		: (song: GenreSong) => Math.log2(1 + song.plays) + Math.log2(song.starred ? rules.likeMultiplier : 1);
	const weights = new Map(
		[...byArtist].map(([artist, songs]) => {
			const plays = songs.reduce((total, song) => total + song.plays, 0);
			return [artist, Math.max(1, fans.get(artist) ?? unknownFans) ** rules.fanPower * (1 + plays / rules.artistPlaysDivisor)];
		})
	);
	const byPopularity = (a: GenreSong, b: GenreSong) => (b.rank ?? 0) - (a.rank ?? 0) || score(b) - score(a) || a.id.localeCompare(b.id);
	const seats = allot(weights, new Map([...byArtist].map(([artist, songs]) => [artist, songs.length])), size, rules);
	const picked = [...seats].flatMap(([artist, count]) => byArtist.get(artist)!.toSorted(byPopularity).slice(0, count));
	const ranked = picked
		.map((song) => ({ song, score: score(song) + rules.weeklyNoise * hash(`${song.id}:${week}`) }))
		.toSorted((a, b) => b.score - a.score);
	// Order by score, but keep `gap` songs between two by the same artist. An artist with many songs
	// left becomes "urgent" once waiting longer would make the spacing impossible to keep.
	const gap = Math.min(rules.artistGap, Math.max(1, Math.floor((seats.size - 1) / 2)));
	const ordered: GenreSong[] = [];
	const left = new Map([...seats].map(([artist, count]) => [artist, Math.min(count, byArtist.get(artist)!.length)]));
	while (ranked.length) {
		const recent = new Set(ordered.slice(Math.max(0, ordered.length - gap)).map((song) => song.artistId));
		const allowed = (entry: (typeof ranked)[number]) => !recent.has(entry.song.artistId);
		const most = Math.max(...left.values());
		const crowded = [...left.values()].filter((count) => count === most).length;
		const urgent = (entry: (typeof ranked)[number]) =>
			left.get(entry.song.artistId) === most && (most - 1) * (gap + 1) + crowded >= ranked.length;
		const index = [ranked.findIndex((entry) => allowed(entry) && urgent(entry)), ranked.findIndex(allowed), 0].find((found) => found >= 0)!;
		const [{ song }] = ranked.splice(index, 1);
		left.set(song.artistId, left.get(song.artistId)! - 1);
		ordered.push(song);
	}
	// The loop above only decides which artist plays at each position; each artist's slots are then
	// filled with their songs in popularity order, so their biggest song comes first.
	const queues = Map.groupBy(picked, (song) => song.artistId);
	return ordered.map((song) => queues.get(song.artistId)!.shift()!);
}
