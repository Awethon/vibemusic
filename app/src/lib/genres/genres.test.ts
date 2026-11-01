import { describe, expect, it } from 'vitest';
import tree from './tree.json';
import { createGenreResolver, regionalGenres, withAncestors } from './genres.ts';

describe('genre resolver', () => {
	it('merges spellings and aliases into one genre', () => {
		const { genresOf } = createGenreResolver();
		expect(genresOf(['Hip-Hop', 'hip hop', 'HipHop', 'Rap', 'хип-хоп'])).toEqual(['Hip-Hop']);
		expect(genresOf(['nu-metal'])).toEqual(['Nu Metal']);
		expect(genresOf(['Drum & Bass', 'drum n bass', 'DnB'])).toEqual(['Drum and Bass']);
		expect(genresOf(['R&B'])).toEqual(['R&B']);
	});

	it('splits combined tags', () => {
		const { genresOf } = createGenreResolver();
		expect(genresOf(['Rap/Hip Hop; Trap'])).toEqual(['Hip-Hop', 'Trap']);
	});

	it('falls back to the broader genre named at the end', () => {
		const { genresOf } = createGenreResolver();
		expect(genresOf(['East Coast Hip Hop', 'Melodic Death Metal', 'Experimental Techno'])).toEqual(['Hip-Hop', 'Death Metal', 'Techno']);
	});

	it('keeps unknown genres under their first spelling and drops placeholders', () => {
		const { genresOf, unknownGenres } = createGenreResolver();
		expect(genresOf(['Zeuhl', 'zeuhl', 'Other', 'unknown'])).toEqual(['Zeuhl']);
		expect(unknownGenres()).toEqual(['Zeuhl']);
	});
});

describe('genre tree', () => {
	it('puts a subgenre under every broader genre', () => {
		expect(withAncestors('Nu Metal').toSorted()).toEqual(['Alternative', 'Alternative Metal', 'Nu Metal', 'Rock']);
		expect(withAncestors('Zeuhl')).toEqual(['Zeuhl']);
		expect(withAncestors('Symphonic Metal')).toContain('Metal');
	});

	it('only names parents that exist', () => {
		const names = new Set(Object.keys(tree));
		const missing = Object.values(tree as Record<string, { parents?: string[] }>).flatMap((node) =>
			(node.parents ?? []).filter((parent) => !names.has(parent))
		);
		expect(missing).toEqual([]);
	});

	it('maps every alias to exactly one genre', () => {
		const owners = new Map<string, string[]>();
		const { genresOf } = createGenreResolver();
		for (const [name, node] of Object.entries(tree as Record<string, { aliases?: string[] }>)) {
			for (const alias of node.aliases ?? [])
				for (const resolved of genresOf([alias]))
					owners.set(alias, [...(owners.get(alias) ?? []), resolved !== name ? `${resolved} (not ${name})` : name]);
		}
		expect([...owners.values()].flat().filter((owner) => owner.includes('(not '))).toEqual([]);
	});
});

describe('regional genres', () => {
	it('files Russian artists under the Russian branch of their genre', () => {
		expect(regionalGenres(withAncestors('Trap'), ['ES', 'RU'])).toEqual(['Russian Hip-Hop']);
		expect(regionalGenres(withAncestors('Nu Metal'), ['RU'])).toEqual(['Russian Rock']);
		expect(regionalGenres(withAncestors('Hip-Hop'), ['US', 'GB'])).toEqual([]);
	});
});
