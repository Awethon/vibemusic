// Runs the store against an in-memory IndexedDB. Each "tab" below is its own copy of the module
// with its own connection, sharing that one database, like browser tabs do.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Store = typeof import('./store.ts');

const CHUNK = 64;
const NAME = 'library-user-v1.sqlite';

async function openTab(): Promise<Store> {
	vi.resetModules();
	return import('./store.ts');
}

function randomness(seed: number) {
	let state = seed;
	return (below: number) => {
		state = (Math.imul(state, 1103515245) + 12345) >>> 0;
		return Math.floor((state / 2 ** 32) * below);
	};
}

function randomBytes(size: number, random: (below: number) => number) {
	const bytes = new Uint8Array(size);
	for (let index = 0; index < size; index++) bytes[index] = random(256);
	return bytes;
}

// Straight at the database, past the store, to look at and damage what is saved.
function raw<T>(mode: IDBTransactionMode, work: (chunks: IDBObjectStore, manifests: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		const open = indexedDB.open('vibemusic-library');
		open.addEventListener('error', () => reject(open.error));
		open.addEventListener('success', () => {
			const transaction = open.result.transaction(['manifest', 'chunk'], mode);
			const request = work(transaction.objectStore('chunk'), transaction.objectStore('manifest'));
			transaction.addEventListener('complete', () => {
				open.result.close();
				resolve(request.result);
			});
			transaction.addEventListener('error', () => reject(transaction.error));
		});
	});
}

const savedChunkCount = async (name: string) =>
	(await raw('readonly', (chunks) => chunks.getAllKeys(IDBKeyRange.bound([name, 0], [name, Infinity])))).length;

// A new, empty browser storage for every test.
beforeEach(() => {
	globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('library store', () => {
	it('writes only the chunks that changed, and drops the ones past a shorter end', async () => {
		const tab = await openTab();
		const bytes = randomBytes(CHUNK * 10 + 20, randomness(1));
		expect(await tab.readFile(NAME)).toBeNull();
		expect(await tab.writeFile(NAME, () => bytes, CHUNK)).toEqual({ size: bytes.length, written: 11 });
		expect((await tab.writeFile(NAME, () => bytes, CHUNK)).written).toBe(0);

		bytes[CHUNK * 4 + 3] ^= 1;
		expect((await tab.writeFile(NAME, () => bytes, CHUNK)).written).toBe(1);
		expect(await tab.readFile(NAME)).toEqual(bytes);

		const shorter = bytes.slice(0, CHUNK * 3 + 5);
		await tab.writeFile(NAME, () => shorter, CHUNK);
		expect(await tab.readFile(NAME)).toEqual(shorter);
		expect(await savedChunkCount(NAME)).toBe(4);
	});

	// The bug this guards against: each tab compared with what it had saved itself, so chunks
	// another tab had rewritten in between were skipped and the file became a mix of both.
	it('holds exactly the last saved bytes however tabs take turns', async () => {
		const random = randomness(42);
		const tabs = [await openTab(), await openTab(), await openTab()];
		const reader = await openTab();
		// Every tab works on its own copy of the database, like tabs that synced at different times.
		const base = randomBytes(CHUNK * 12, random);
		const copies = tabs.map(() => base.slice());
		for (let round = 0; round < 150; round++) {
			const who = random(tabs.length);
			let copy = copies[who];
			if (random(8) === 0) copy = copies[who] = randomBytes(CHUNK * (1 + random(16)) + random(CHUNK), random);
			for (let edits = random(4); edits > 0; edits--) copy[random(copy.length)] ^= 1 + random(255);
			await tabs[who].writeFile(NAME, () => copy, CHUNK);
			expect(await reader.readFile(NAME), `round ${round}`).toEqual(copy);
			expect(await savedChunkCount(NAME), `round ${round}`).toBe(Math.ceil(copy.length / CHUNK));
		}
	});

	it('holds one tab’s bytes, not a mix, when tabs save at the same moment', async () => {
		const random = randomness(7);
		const tabs = [await openTab(), await openTab(), await openTab()];
		const base = randomBytes(CHUNK * 20, random);
		await tabs[0].writeFile(NAME, () => base, CHUNK);
		for (let round = 0; round < 20; round++) {
			const versions = tabs.map(() => {
				const copy = base.slice();
				for (let edits = 1 + random(6); edits > 0; edits--) copy[random(copy.length)] ^= 1 + random(255);
				return copy;
			});
			await Promise.all(tabs.map((tab, index) => tab.writeFile(NAME, () => versions[index], CHUNK)));
			const saved = await tabs[0].readFile(NAME);
			expect(
				versions.some((version) => saved?.every((byte, index) => byte === version[index])),
				`round ${round}`
			).toBe(true);
		}
	});

	it('keeps the previous file when a save breaks off halfway', async () => {
		const tab = await openTab();
		const before = randomBytes(CHUNK * 8, randomness(3));
		await tab.writeFile(NAME, () => before, CHUNK);
		const after = randomBytes(CHUNK * 8, randomness(4));

		const put = IDBObjectStore.prototype.put;
		let puts = 0;
		vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
			if (++puts === 4) throw new RangeError('Array buffer allocation failed');
			return put.apply(this, args);
		});
		await expect(tab.writeFile(NAME, () => after, CHUNK)).rejects.toThrow('allocation failed');
		vi.restoreAllMocks();
		expect(await tab.readFile(NAME)).toEqual(before);

		await expect(
			tab.writeFile(
				NAME,
				() => {
					throw new Error('export failed');
				},
				CHUNK
			)
		).rejects.toThrow('export failed');
		expect(await tab.readFile(NAME)).toEqual(before);
		expect((await tab.writeFile(NAME, () => after, CHUNK)).written).toBe(8);
		expect(await tab.readFile(NAME)).toEqual(after);
	});

	// A file like that would open as a damaged database. Read as missing, it is synced afresh.
	it('reads a file as missing when a chunk is gone or is not the one that was saved', async () => {
		const tab = await openTab();
		const bytes = randomBytes(CHUNK * 6, randomness(5));
		await tab.writeFile(NAME, () => bytes, CHUNK);

		const other = randomBytes(CHUNK, randomness(6));
		await raw('readwrite', (chunks) => chunks.put(new Blob([other]), [NAME, 2]));
		expect(await tab.readFile(NAME).catch(() => null)).toBeNull();

		await tab.writeFile(NAME, () => bytes.slice(), CHUNK);
		await raw('readwrite', (chunks) => chunks.delete([NAME, 5]));
		expect(await tab.readFile(NAME).catch(() => null)).toBeNull();
	});

	it('removes one file without touching another whose name starts the same', async () => {
		const tab = await openTab();
		const first = randomBytes(CHUNK * 3, randomness(8));
		const second = randomBytes(CHUNK * 5, randomness(9));
		await tab.writeFile('library-user-v1.sqlite', () => first, CHUNK);
		await tab.writeFile('library-user-v12.sqlite', () => second, CHUNK);
		await tab.removeFile('library-user-v1.sqlite');
		expect(await tab.listFiles()).toEqual(['library-user-v12.sqlite']);
		expect(await tab.readFile('library-user-v12.sqlite')).toEqual(second);
		expect(await savedChunkCount('library-user-v1.sqlite')).toBe(0);
	});
});
