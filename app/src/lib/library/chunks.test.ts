import { describe, expect, it } from 'vitest';
import { changedChunks, chunkHashes, joinChunks } from './chunks.ts';

const pseudoRandom = (size: number, seed = 7) => {
	const bytes = new Uint8Array(size);
	let state = seed;
	for (let index = 0; index < size; index++) {
		state = (Math.imul(state, 1103515245) + 12345) >>> 0;
		bytes[index] = state >>> 24;
	}
	return bytes;
};

describe('chunks', () => {
	it('flags exactly the chunks a change touches', () => {
		const bytes = pseudoRandom(64 * 10 + 20);
		const before = chunkHashes(bytes, 64);
		expect(before).toHaveLength(11);
		bytes[64 * 3 + 5] ^= 1;
		bytes[64 * 10 + 19] ^= 0x80;
		expect(changedChunks(before, chunkHashes(bytes, 64))).toEqual([3, 10]);
	});

	it('notices a change in any byte of a chunk', () => {
		const bytes = pseudoRandom(64);
		const [original] = chunkHashes(bytes, 64);
		for (let index = 0; index < bytes.length; index++) {
			bytes[index] ^= 1;
			expect(chunkHashes(bytes, 64)[0]).not.toBe(original);
			bytes[index] ^= 1;
		}
	});

	it('hashes unaligned views the same as aligned copies', () => {
		const backing = pseudoRandom(300);
		const unaligned = backing.subarray(3, 3 + 256);
		expect(chunkHashes(unaligned, 64)).toEqual(chunkHashes(unaligned.slice(), 64));
	});

	it('treats every chunk as changed without a previous save, and growth as new chunks', () => {
		const small = chunkHashes(pseudoRandom(128), 64);
		expect(changedChunks(null, small)).toEqual([0, 1]);
		const grown = pseudoRandom(256);
		expect(changedChunks(small, chunkHashes(grown, 64))).toEqual([2, 3]);
	});

	it('joins chunks back into the original bytes', () => {
		const bytes = pseudoRandom(64 * 3 + 7);
		const parts = [0, 64, 128, 192].map((start) => bytes.slice(start, start + 64));
		expect(joinChunks(parts, bytes.length)).toEqual(bytes);
		expect(() => joinChunks(parts.slice(0, 3), bytes.length)).toThrow();
	});
});
