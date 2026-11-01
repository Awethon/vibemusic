import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { md5 } from './md5.ts';

describe('md5', () => {
	it('matches the reference vectors', () => {
		expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
		expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
		expect(md5('The quick brown fox jumps over the lazy dog')).toBe('9e107d9d372bb6826bd81d3542a419d6');
	});

	it('matches node for multi-block and non-ascii input', () => {
		for (const text of ['a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'x'.repeat(1000), 'пароль✓密码', 'sesame' + 'f00dfeed1234']) {
			expect(md5(text)).toBe(createHash('md5').update(text).digest('hex'));
		}
	});
});
