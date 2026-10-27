import { expect, it } from 'vitest';
import { songRanks, titleKey } from './titles.ts';

it('matches titles the way the relay does', () => {
	expect(titleKey('Lights on a Hill (Remastered)')).toBe(titleKey('Lights On a Hill'));
	expect(titleKey('Undertow - Live at Harbour Hall')).toBe('undertow');
	expect(titleKey('Ёжик [Bonus Track]')).toBe('ежик');
	const rank = songRanks([['Open Road', 982895], ['Open Road (Live)', 400000], ['Undertow', 974827]]);
	expect(rank('open road')).toBe(982895);
	expect(rank('Open Road (Live)')).toBe(400000);
	expect(rank('Undertow (Remastered 2023)')).toBe(974827);
	expect(rank('Driftwood')).toBeNull();
});
