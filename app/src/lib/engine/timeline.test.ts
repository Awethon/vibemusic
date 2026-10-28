import { expect, it } from 'vitest';
import { laneSpan, laneYears, layoutTimeline, markedBuckets, timelineLanes, type TimelineAlbum } from './timeline.ts';

const album = (id: string, artistId: string, year: number, created = '2026-10-13T10:00:00Z'): TimelineAlbum => ({ id, name: id, artistId, artist: artistId.toUpperCase(), year, created });
const metrics = { cover: 60, gap: 10, pad: 20, empty: 30, start: 200, tail: 100 };

it('gives artists with enough albums their own lane, ordered by debut, and pools the rest', () => {
	const lanes = timelineLanes([album('a1', 'late', 2010), album('a2', 'late', 2012), album('b1', 'early', 1995), album('b2', 'early', 1999), album('c1', 'once', 2001)], 2, 'Elsewhere');
	expect(lanes.map((lane) => lane.label)).toEqual(['EARLY', 'LATE', 'Elsewhere']);
	expect(lanes[2].albums.map((entry) => entry.id)).toEqual(['c1']);
});

it('makes a year as wide as its busiest lane and keeps empty years thin', () => {
	const lanes = timelineLanes([album('a1', 'a', 2000), album('a2', 'a', 2000), album('b1', 'b', 2000), album('b2', 'b', 2002)], 1, 'Elsewhere');
	const layout = layoutTimeline(lanes, 'released', metrics);
	expect(layout.buckets.map((bucket) => [bucket.key, bucket.width, bucket.count])).toEqual([
		[1999, 30, 0],
		[2000, 150, 3],
		[2001, 30, 0],
		[2002, 80, 1],
		[2003, 30, 0]
	]);
	expect(layout.positions.get('a2')).toEqual({ x: 200 + 30 + 10 + 70, lane: 0 });
	expect(layout.positions.get('b2')).toEqual({ x: 200 + 30 + 150 + 30 + 10, lane: 1 });
	expect(laneSpan(lanes[0], layout, 60)).toEqual({ from: 240, to: 370 });
});

it('leaves albums without a year off the released axis and buckets added dates finely when they are close together', () => {
	const lanes = timelineLanes([album('a1', 'a', 0, '2026-10-13T10:05:00Z'), album('a2', 'a', 2001, '2026-10-13T12:30:00Z')], 1, 'Elsewhere');
	expect([...layoutTimeline(lanes, 'released', metrics).positions.keys()]).toEqual(['a2']);
	const added = layoutTimeline(lanes, 'added', metrics);
	expect(added.positions.size).toBe(2);
	expect(added.buckets.filter((bucket) => bucket.count).length).toBe(2);
});

it('writes a lane’s years compactly', () => {
	expect(laneYears(timelineLanes([album('a', 'x', 1992), album('b', 'x', 2014)], 1, '')[0])).toBe('1992–2014');
	expect(laneYears(timelineLanes([album('a', 'x', 2001), album('b', 'x', 2009)], 1, '')[0])).toBe('2001–09');
});

it('labels quiet five-year marks only where they have room', () => {
	const lanes = timelineLanes([album('a', 'x', 1994), album('b', 'x', 1997), album('c', 'x', 2010)], 1, '');
	const marked = markedBuckets(layoutTimeline(lanes, 'released', metrics).buckets, 72);
	expect(marked.map((bucket) => bucket.key)).toEqual([1994, 1997, 2000, 2005, 2010]);
});
