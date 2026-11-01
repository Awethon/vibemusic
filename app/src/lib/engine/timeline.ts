export type TimelineAlbum = { id: string; name: string; artistId: string; artist: string; year: number };
export type Lane = { artistId: string | null; label: string; albums: TimelineAlbum[] };
export type Bucket = { key: number; label: string; era: string; x: number; width: number; count: number; minor: boolean };
export type TimelineLayout = { buckets: Bucket[]; positions: Map<string, { x: number; lane: number }>; width: number };
export type TimelineMetrics = { cover: number; gap: number; pad: number; empty: number; start: number; tail: number };

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

function describe(year: number): { label: string; era: string; minor: boolean } {
	return { label: String(year), era: `${Math.floor(year / 10) * 10}s`, minor: year % 5 === 0 };
}

export function layoutTimeline(lanes: Lane[], metrics: TimelineMetrics): TimelineLayout {
	const perLane = lanes.map((lane) => {
		const groups = new Map<number, TimelineAlbum[]>();
		for (const album of lane.albums) {
			const key = album.year;
			if (!key) continue;
			const group = groups.get(key);
			if (group) group.push(album);
			else groups.set(key, [album]);
		}
		for (const group of groups.values()) group.sort((a, b) => a.name.localeCompare(b.name));
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
		perLane.forEach((groups, lane) =>
			groups.get(key)?.forEach((album, index) => positions.set(album.id, { x: x + metrics.pad / 2 + index * step, lane }))
		);
		buckets.push({ key, ...describe(key), x, width, count: counts.reduce((total, count) => total + count, 0) });
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
