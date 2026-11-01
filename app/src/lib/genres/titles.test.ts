import { expect, it } from 'vitest';
import { songRanks, titleKey } from './titles.ts';

it('matches titles the way the relay does', () => {
	expect(titleKey('Lights on a Hill (Remastered)')).toBe(titleKey('Lights On a Hill'));
	expect(titleKey('Undertow - Live at Harbour Hall')).toBe('undertow');
	expect(titleKey('Ёжик [Bonus Track]')).toBe('ежик');
	expect(titleKey('Тихий город при уч. Иван Петров')).toBe(titleKey('Тихий город (feat. Иван Петров)'));
	expect(titleKey('Night Drive feat. Sam Rivers')).toBe('nightdrive');
	const rank = songRanks([
		['Open Road', 982895],
		['Open Road (Live)', 400000],
		['Undertow', 974827]
	]);
	expect(rank('open road')).toBe(982895);
	expect(rank('Open Road (Live)')).toBe(400000);
	expect(rank('Undertow (Remastered 2023)')).toBe(974827);
	expect(rank('Driftwood')).toBeNull();
	const orchard = songRanks([
		['Paper Moon', 693944],
		['Small Hours (Album Version)', 321967]
	]);
	expect(orchard('Paper Moon (Night Owl club mix)')).toBeNull();
	expect(orchard('Paper Moon - Live')).toBeNull();
	expect(orchard('Paper Moon (Remastered 2023)')).toBe(693944);
	expect(orchard('Small Hours')).toBe(321967);
});
