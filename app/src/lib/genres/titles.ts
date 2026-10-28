const letters = (text: string) => [...text.toLowerCase().replaceAll('ё', 'е')].filter((character) => /[\p{L}\p{N}]/u.test(character)).join('');

const RECORDING = /(^|[^\p{L}])(remix|rmx|mix|live|instrumental|acoustic|unplugged|demo|cover|karaoke|rework|bootleg|reprise|ремикс|микс|кавер|инструментал|акустика|акустическая|лайв|концерт)([^\p{L}]|$)/iu;

function split(title: string) {
	let depth = 0;
	let kept = '';
	let extra = '';
	for (const character of title) {
		if (character === '(' || character === '[') depth++;
		else if (character === ')' || character === ']') depth = Math.max(0, depth - 1);
		else if (depth === 0) kept += character;
		else extra += character;
	}
	const [base, ...rest] = kept.split(' - ');
	return { base, extra: `${extra} ${rest.join(' ')}` };
}

export const titleKey = (title: string) => letters(split(title).base);

export const isOtherRecording = (title: string) => RECORDING.test(split(title).extra);

export const isPlainTitle = (title: string) => letters(title) === titleKey(title);

export function songRanks(top: [string, number][]) {
	const exact = new Map<string, number>();
	const loose = new Map<string, number>();
	for (const [title, rank] of top) {
		if (!exact.has(letters(title))) exact.set(letters(title), rank);
		if (!isOtherRecording(title) && !loose.has(titleKey(title))) loose.set(titleKey(title), rank);
	}
	return (title: string) => exact.get(letters(title)) ?? (isOtherRecording(title) ? null : loose.get(titleKey(title))) ?? null;
}
