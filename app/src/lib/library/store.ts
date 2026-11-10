// IndexedDB storage for library database files: a manifest per file (size, chunk size, chunk
// hashes) plus chunks keyed [name, index]. Used only by the library worker.

import { changedChunks, chunkHashes, joinChunks } from './chunks.ts';

const DATABASE = 'vibemusic-library';
const MANIFESTS = 'manifest';
const CHUNKS = 'chunk';

type Manifest = { name: string; size: number; chunkSize: number; hashes: string[] };

let opened: Promise<IDBDatabase> | null = null;

const settle = <T>(request: IDBRequest<T>) =>
	new Promise<T>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});

const finish = (transaction: IDBTransaction) =>
	new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
		transaction.onabort = () => reject(transaction.error ?? new Error('Library save was aborted'));
	});

function store(): Promise<IDBDatabase> {
	opened ??= new Promise((resolve, reject) => {
		const request = indexedDB.open(DATABASE, 1);
		request.onupgradeneeded = () => {
			request.result.createObjectStore(MANIFESTS, { keyPath: 'name' });
			request.result.createObjectStore(CHUNKS);
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
	return opened;
}

const chunksOf = (name: string, from = 0) => IDBKeyRange.bound([name, from], [name, Infinity]);

// Returns null when the file is missing, incomplete or not what was saved; callers then sync from
// scratch.
export async function readFile(name: string): Promise<Uint8Array<ArrayBuffer> | null> {
	const transaction = (await store()).transaction([MANIFESTS, CHUNKS], 'readonly');
	const [manifest, parts] = await Promise.all([
		settle<Manifest | undefined>(transaction.objectStore(MANIFESTS).get(name)),
		settle<Blob[]>(transaction.objectStore(CHUNKS).getAll(chunksOf(name)))
	]);
	if (!manifest || parts.length !== manifest.hashes.length) return null;
	const chunks = await Promise.all(parts.map(async (part) => new Uint8Array(await part.arrayBuffer())));
	// A chunk that is not the one its manifest was saved with would open as a damaged database.
	// Saves by versions that compared with the tab's own last save could leave such a mix of two
	// tabs' files, and nothing later repairs it: a save skips chunks whose stored hash is right.
	if (chunks.some((chunk, index) => chunkHashes(chunk, chunk.length)[0] !== manifest.hashes[index])) return null;
	return joinChunks(chunks, manifest.size);
}

/**
 * Saves `name`, writing only the chunks whose hash differs from the stored ones. Everything
 * happens in one transaction, so a crash never leaves a manifest that points at a mix of old and
 * new chunks; an error on the way cancels the transaction for the same reason.
 *
 * The stored hashes are read inside that transaction, not remembered from this tab's last save:
 * another tab may have saved since, and skipping chunks it rewrote would leave a mix of both
 * tabs' files. The browser runs write transactions on these stores one after another, across
 * tabs, so the file always ends up as exactly the bytes of whoever saved last.
 */
export async function writeFile(name: string, snapshot: () => Uint8Array, chunkSize: number): Promise<{ size: number; written: number }> {
	const transaction = (await store()).transaction([MANIFESTS, CHUNKS], 'readwrite');
	const done = finish(transaction);
	// A failed read below also aborts the transaction; the read reports that failure itself.
	done.catch(() => {});
	try {
		const manifests = transaction.objectStore(MANIFESTS);
		const stored = await settle<Manifest | undefined>(manifests.get(name));
		// Taken only after the awaits above and used without awaiting: the bytes may be a live view
		// of the database's memory, which could change while another worker request runs.
		const bytes = snapshot();
		const hashes = chunkHashes(bytes, chunkSize);
		const changed = changedChunks(stored?.chunkSize === chunkSize ? stored.hashes : null, hashes);
		const chunks = transaction.objectStore(CHUNKS);
		for (const index of changed) chunks.put(new Blob([bytes.slice(index * chunkSize, (index + 1) * chunkSize)]), [name, index]);
		// The database may have shrunk: drop chunks past the new end.
		chunks.delete(chunksOf(name, hashes.length));
		manifests.put({ name, size: bytes.length, chunkSize, hashes } satisfies Manifest);
		await done;
		return { size: bytes.length, written: changed.length };
	} catch (error) {
		// Left alone, the transaction would commit the chunks put before the error under the old
		// manifest. It is already over when the error is its own.
		try {
			transaction.abort();
		} catch {
			// Already finished.
		}
		throw error;
	}
}

export async function listFiles(): Promise<string[]> {
	return (await settle((await store()).transaction(MANIFESTS, 'readonly').objectStore(MANIFESTS).getAllKeys())).map(String);
}

export async function removeFile(name: string) {
	const transaction = (await store()).transaction([MANIFESTS, CHUNKS], 'readwrite');
	const done = finish(transaction);
	transaction.objectStore(MANIFESTS).delete(name);
	transaction.objectStore(CHUNKS).delete(chunksOf(name));
	await done;
}
