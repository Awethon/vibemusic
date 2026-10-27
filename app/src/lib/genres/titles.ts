const letters = (text: string) => [...text.toLowerCase().replaceAll('ё', 'е')].filter((character) => /[\p{L}\p{N}]/u.test(character)).join('');

export function titleKey(title: string) {
	let depth = 0;
	let kept = '';
	for (const character of title) {
		if (character === '(' || character === '[') depth++;
		else if (character === ')' || character === ']') depth = Math.max(0, depth - 1);
		else if (depth === 0) kept += character;
	}
	return letters(kept.split(' - ')[0]);
}

export function songRanks(top: [string, number][]) {
	const exact = new Map<string, number>();
	const loose = new Map<string, number>();
	for (const [title, rank] of top) {
		if (!exact.has(letters(title))) exact.set(letters(title), rank);
		if (!loose.has(titleKey(title))) loose.set(titleKey(title), rank);
	}
	return (title: string) => exact.get(letters(title)) ?? loose.get(titleKey(title)) ?? null;
}
