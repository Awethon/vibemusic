// The fixed genre tree (tree.json: name -> parents and aliases) and the resolver that maps messy
// raw tags onto it. Tags that match nothing are kept as-is (unknownGenres) rather than dropped.
import tree from './tree.json';

type Node = { parents?: string[]; aliases?: string[] };

// Keys (after genreKey) of tags that say nothing about genre, including listening-habit tags.
const IGNORED = new Set([
	'other',
	'others',
	'unknown',
	'misc',
	'miscellaneous',
	'genre',
	'none',
	'various',
	'instrumental',
	'seenlive',
	'favorites',
	'favourites'
]);

// Normalises a tag into words so "Drum & Bass", "drum n bass" and "Drum-and-Bass" compare equal.
// ё -> е because Russian tags spell it both ways. Lookups join the words with no separator.
export const genreKey = (text: string) =>
	text
		.normalize('NFKC')
		.toLowerCase()
		.replaceAll('ё', 'е')
		.replace(/\s*&\s*|\s+'?n'?\s+/g, ' and ')
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);

const nodes = tree as Record<string, Node>;

// FNV-1a hash of tree.json, folded into the library schema version (library/schema.ts) so that
// editing the tree makes clients rebuild their genre assignments.
export const TREE_VERSION = (() => {
	const text = JSON.stringify(tree);
	let value = 2166136261;
	for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
	return (value >>> 0).toString(36);
})();
const byKey = new Map<string, string>();
for (const [name, node] of Object.entries(nodes))
	for (const label of [name, ...(node.aliases ?? [])]) byKey.set(genreKey(label).join(''), name);

// Tries the whole tag, then drops leading words: "Melodic Death Metal" falls back to "Death Metal".
// Only leading words are dropped, because the broad genre is usually named last.
const known = (words: string[]) => {
	for (let start = 0; start < words.length; start++) {
		const name = byKey.get(words.slice(start).join(''));
		if (name) return name;
	}
	return null;
};

// File tags often pack several genres into one string ("Rap/Hip Hop; Trap"), but some names contain
// a separator themselves ("singer/songwriter"), so a string that is a known genre as a whole is never split.
export const splitGenres = (raw: string) => (byKey.has(genreKey(raw).join('')) ? [raw] : raw.split(/\s*[/;|,]\s*/).filter(Boolean));

export function createGenreResolver() {
	const unknown = new Map<string, string>();

	function resolve(raw: string): string | null {
		const words = genreKey(raw);
		const key = words.join('');
		if (!key || IGNORED.has(key)) return null;
		const name = known(words);
		if (name) return name;
		// The first spelling seen becomes the display name for all variants of an unknown tag.
		if (!unknown.has(key)) unknown.set(key, raw.trim());
		return unknown.get(key)!;
	}

	return {
		genresOf(rawGenres: string[]): string[] {
			return [
				...new Set(
					rawGenres
						.flatMap(splitGenres)
						.map(resolve)
						.filter((name): name is string => !!name)
				)
			];
		},
		// Used for enrichment tags, which are free-form and noisy: only tree genres count there.
		knownGenre(raw: string): string | null {
			const words = genreKey(raw);
			return IGNORED.has(words.join('')) ? null : known(words);
		},
		unknownGenres: () => [...unknown.values()]
	};
}

const lineage = new Map<string, string[]>();

export function withAncestors(name: string): string[] {
	const cached = lineage.get(name);
	if (cached) return cached;
	const found = new Set<string>();
	const visit = (current: string) => {
		if (found.has(current)) return;
		found.add(current);
		for (const parent of nodes[current]?.parents ?? []) visit(parent);
	};
	visit(name);
	const result = [...found];
	lineage.set(name, result);
	return result;
}

export const parentsOf = (name: string) => nodes[name]?.parents ?? [];

export type GenreResolver = ReturnType<typeof createGenreResolver>;

const children = new Map<string, string[]>();
for (const [name, node] of Object.entries(nodes))
	for (const parent of node.parents ?? []) children.set(parent, [...(children.get(parent) ?? []), name]);

const breadth = new Map<string, number>();

export function descendantCount(name: string): number {
	const cached = breadth.get(name);
	if (cached !== undefined) return cached;
	const found = new Set<string>();
	const visit = (current: string) => {
		for (const child of children.get(current) ?? []) {
			if (found.has(child)) continue;
			found.add(child);
			visit(child);
		}
	};
	visit(name);
	breadth.set(name, found.size);
	return found.size;
}

// Regional sub-genres added from the artist's country (from MusicBrainz) rather than from tags.
const REGIONAL: Record<string, Record<string, string>> = {
	RU: { 'Hip-Hop': 'Russian Hip-Hop', Rock: 'Russian Rock', Pop: 'Russian Pop' }
};

export function regionalGenres(genres: string[], countries: string[]): string[] {
	return countries.flatMap((country) =>
		Object.entries(REGIONAL[country] ?? {}).flatMap(([genre, regional]) => (genres.includes(genre) ? [regional] : []))
	);
}
