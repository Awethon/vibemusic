export type TimelineAlbum = { id: string; name: string; artistId: string; artist: string; year: number; created: string };
export type Lane = { artistId: string | null; label: string; albums: TimelineAlbum[] };
export type TimelineAxis = 'released' | 'added';
export type Bucket = { key: number; label: string; era: string; x: number; width: number; count: number; minor: boolean };
export type TimelineLayout = { buckets: Bucket[]; positions: Map<string, { x: number; lane: number }>; width: number };
export type TimelineMetrics = { cover: number; gap: number; pad: number; empty: number; start: number; tail: number };

type Grain = 'year' | 'month' | 'day' | 'hour';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function timelineLanes(albums: TimelineAlbum[], minAlbums: number, elsewhere: string): Lane[] {
	const byArtist = Map.groupBy(albums, (album) => album.artistId);
	const main: Lane[] = [];
	const rest: TimelineAlbum[] = [];
	for (const [artistId, list] of byArtist) {
		if (artistId && list.length >= minAlbums) main.push({ artistId, label: list[0].artist, albums: list });
		else rest.push(...list);
	}
	const firstYear = (lane: Lane) => Math.min(...lane.albums.map((album) => album.year || Number.MAX_SAFE_INTEGER));
	main.sort((a, b) => firstYear(a) - firstYear(b) || b.albums.length - a.albums.length || a.label.localeCompare(b.label));
	return rest.length ? [...main, { artistId: null, label: elsewhere, albums: rest }] : main;
}

function grainFor(times: number[]): Grain {
	const span = Math.max(...times) - Math.min(...times);
	if (span < 2 * DAY_MS) return 'hour';
	if (span < 120 * DAY_MS) return 'day';
	return 'month';
}

function keyOf(album: TimelineAlbum, grain: Grain): number | null {
	if (grain === 'year') return album.year || null;
	const time = Date.parse(album.created);
	if (!Number.isFinite(time)) return null;
	if (grain === 'hour') return Math.floor(time / HOUR_MS);
	if (grain === 'day') return Math.floor(time / DAY_MS);
	const date = new Date(time);
	return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

function describe(key: number, grain: Grain): { label: string; era: string; minor: boolean } {
	if (grain === 'year') return { label: String(key), era: `${Math.floor(key / 10) * 10}s`, minor: key % 5 === 0 };
	if (grain === 'month') {
		const date = new Date(Date.UTC(Math.floor(key / 12), key % 12, 1));
		return { label: date.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }), era: String(date.getUTCFullYear()), minor: key % 12 === 0 };
	}
	const date = new Date(key * (grain === 'day' ? DAY_MS : HOUR_MS));
	const day = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
	if (grain === 'day') return { label: day, era: date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), minor: date.getDay() === 1 };
	return { label: `${String(date.getHours()).padStart(2, '0')}:00`, era: day, minor: date.getHours() % 6 === 0 };
}

export function layoutTimeline(lanes: Lane[], axis: TimelineAxis, metrics: TimelineMetrics): TimelineLayout {
	const all = lanes.flatMap((lane) => lane.albums);
	const grain: Grain = axis === 'released' ? 'year' : grainFor(all.map((album) => Date.parse(album.created)).filter(Number.isFinite));
	const perLane = lanes.map((lane) => {
		const groups = new Map<number, TimelineAlbum[]>();
		for (const album of lane.albums) {
			const key = keyOf(album, grain);
			if (key === null) continue;
			const group = groups.get(key);
			if (group) group.push(album);
			else groups.set(key, [album]);
		}
		for (const group of groups.values()) group.sort(axis === 'added' ? (a, b) => Date.parse(a.created) - Date.parse(b.created) : (a, b) => a.name.localeCompare(b.name));
		return groups;
	});
	const keys = perLane.flatMap((groups) => [...groups.keys()]);
	const positions = new Map<string, { x: number; lane: number }>();
	const buckets: Bucket[] = [];
	if (!keys.length) return { buckets, positions, width: metrics.start + metrics.tail };
	const step = metrics.cover + metrics.gap;
	let x = metrics.start;
	for (let key = Math.min(...keys) - 1; key <= Math.max(...keys) + 1; key++) {
		const counts = perLane.map((groups) => groups.get(key)?.length ?? 0);
		const most = Math.max(...counts);
		const width = most ? most * step - metrics.gap + metrics.pad : metrics.empty;
		perLane.forEach((groups, lane) => groups.get(key)?.forEach((album, index) => positions.set(album.id, { x: x + metrics.pad / 2 + index * step, lane })));
		buckets.push({ key, ...describe(key, grain), x, width, count: counts.reduce((total, count) => total + count, 0) });
		x += width;
	}
	return { buckets, positions, width: x + metrics.tail };
}

export function markedBuckets(buckets: Bucket[], room: number): Bucket[] {
	const marked: Bucket[] = [];
	buckets.forEach((bucket, index) => {
		if (bucket.count) return marked.push(bucket);
		if (!bucket.minor) return;
		const next = buckets.slice(index + 1).find((later) => later.count);
		const previous = marked.at(-1);
		if ((!next || next.x - bucket.x >= room) && (!previous || bucket.x - previous.x >= room)) marked.push(bucket);
	});
	return marked;
}

export function laneSpan(lane: Lane, layout: TimelineLayout, cover: number): { from: number; to: number } | null {
	const xs = lane.albums.flatMap((album) => {
		const position = layout.positions.get(album.id);
		return position ? [position.x] : [];
	});
	return xs.length ? { from: Math.min(...xs), to: Math.max(...xs) + cover } : null;
}

export function laneYears(lane: Lane): string {
	const years = lane.albums.map((album) => album.year).filter(Boolean);
	if (!years.length) return '';
	const first = Math.min(...years);
	const last = Math.max(...years);
	return first === last ? String(first) : `${first}–${String(last).slice(Math.floor(first / 100) === Math.floor(last / 100) ? 2 : 0)}`;
}
