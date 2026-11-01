import tree from './tree.json';

type Node = { parents?: string[]; aliases?: string[] };

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

export const genreKey = (text: string) =>
	text
		.normalize('NFKC')
		.toLowerCase()
		.replaceAll('ё', 'е')
		.replace(/\s*&\s*|\s+'?n'?\s+/g, ' and ')
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);

const nodes = tree as Record<string, Node>;

export const TREE_VERSION = (() => {
	const text = JSON.stringify(tree);
	let value = 2166136261;
	for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
	return (value >>> 0).toString(36);
})();
const byKey = new Map<string, string>();
for (const [name, node] of Object.entries(nodes))
	for (const label of [name, ...(node.aliases ?? [])]) byKey.set(genreKey(label).join(''), name);

const known = (words: string[]) => {
	for (let start = 0; start < words.length; start++) {
		const name = byKey.get(words.slice(start).join(''));
		if (name) return name;
	}
	return null;
};

export const splitGenres = (raw: string) => (byKey.has(genreKey(raw).join('')) ? [raw] : raw.split(/\s*[/;|,]\s*/).filter(Boolean));

export function createGenreResolver() {
	const unknown = new Map<string, string>();

	function resolve(raw: string): string | null {
		const words = genreKey(raw);
		const key = words.join('');
		if (!key || IGNORED.has(key)) return null;
		const name = known(words);
		if (name) return name;
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

const REGIONAL: Record<string, Record<string, string>> = {
	RU: { 'Hip-Hop': 'Russian Hip-Hop', Rock: 'Russian Rock', Pop: 'Russian Pop' }
};

export function regionalGenres(genres: string[], countries: string[]): string[] {
	return countries.flatMap((country) =>
		Object.entries(REGIONAL[country] ?? {}).flatMap(([genre, regional]) => (genres.includes(genre) ? [regional] : []))
	);
}
