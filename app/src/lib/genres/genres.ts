import tree from './tree.json';

type Node = { parents?: string[]; aliases?: string[] };

const IGNORED = new Set(['other', 'others', 'unknown', 'misc', 'miscellaneous', 'genre', 'none', 'various', 'instrumental', 'seenlive', 'favorites', 'favourites']);

export const genreKey = (text: string) =>
	text
		.normalize('NFKC')
		.toLowerCase()
		.replaceAll('ё', 'е')
		.replace(/\s*&\s*|\s+'?n'?\s+/g, ' and ')
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);

const nodes = tree as Record<string, Node>;
const byKey = new Map<string, string>();
for (const [name, node] of Object.entries(nodes)) for (const label of [name, ...(node.aliases ?? [])]) byKey.set(genreKey(label).join(''), name);

const known = (words: string[]) => {
	for (let start = 0; start < words.length; start++) {
		const name = byKey.get(words.slice(start).join(''));
		if (name) return name;
	}
	return null;
};

export const splitGenres = (raw: string) => (byKey.has(genreKey(raw).join('')) ? [raw] : raw.split(/\s*[/;|,]\s*/).filter(Boolean));

export function createGenreResolver(existing: string[] = []) {
	const unknown = new Map<string, string>();
	for (const name of existing) if (!(name in nodes)) unknown.set(genreKey(name).join(''), name);

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
			return [...new Set(rawGenres.flatMap(splitGenres).map(resolve).filter((name): name is string => !!name))];
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
