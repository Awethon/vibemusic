// Title normalisation for matching local songs and albums against Deezer/Apple charts and albums,
// and for telling a song's original from its remixes, live takes and covers.
const letters = (text: string) =>
	[...text.toLowerCase().replaceAll('ё', 'е')].filter((character) => /[\p{L}\p{N}]/u.test(character)).join('');

const RECORDING =
	/(^|[^\p{L}])(remix|rmx|mix|live|instrumental|acoustic|unplugged|demo|cover|karaoke|rework|bootleg|reprise|ремикс|микс|кавер|инструментал|акустика|акустическая|лайв|концерт)([^\p{L}]|$)/iu;

const FEATURING = [' feat.', ' feat ', ' ft.', ' ft ', ' featuring ', ' при уч', ' при участии', ' w/ '];

// base: the title without bracketed parts, anything after " - ", and featured artists.
// extra: the stripped parts, which is where "(Remix)" or "- Live" markers live.
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
	const [whole, ...rest] = kept.split(' - ');
	const lower = `${whole.toLowerCase()} `;
	const end = Math.min(...FEATURING.map((marker) => lower.indexOf(marker)).filter((index) => index >= 0), lower.length);
	return { base: lower.slice(0, end), extra: `${extra} ${rest.join(' ')}` };
}

export const titleKey = (title: string) => letters(split(title).base);

export const isOtherRecording = (title: string) => RECORDING.test(split(title).extra);

export const isPlainTitle = (title: string) => letters(title) === titleKey(title);

// Builds a lookup from a chart (title, rank). An exact title match wins; otherwise the loose title
// key is used, but never for a remix/live/cover, so those don't inherit the original's rank.
export function songRanks(top: [string, number][]) {
	const exact = new Map<string, number>();
	const loose = new Map<string, number>();
	for (const [title, rank] of top) {
		if (!exact.has(letters(title))) exact.set(letters(title), rank);
		if (!isOtherRecording(title) && !loose.has(titleKey(title))) loose.set(titleKey(title), rank);
	}
	return (title: string) => exact.get(letters(title)) ?? (isOtherRecording(title) ? null : loose.get(titleKey(title))) ?? null;
}
