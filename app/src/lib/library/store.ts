// IndexedDB storage for library database files: a manifest per file (size, chunk size, chunk
// hashes) plus chunks keyed [name, index]. Used only by the library worker.

import { changedChunks, chunkHashes, joinChunks } from './chunks.ts';

const DATABASE = 'vibemusic-library';
const MANIFESTS = 'manifest';
const CHUNKS = 'chunk';

export type Saved = { chunkSize: number; hashes: string[] };
type Manifest = Saved & { name: string; size: number };

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

// Returns null when the file is missing or incomplete; callers then sync from scratch.
export async function readFile(name: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; saved: Saved } | null> {
	const transaction = (await store()).transaction([MANIFESTS, CHUNKS], 'readonly');
	const [manifest, parts] = await Promise.all([
		settle<Manifest | undefined>(transaction.objectStore(MANIFESTS).get(name)),
		settle<Blob[]>(transaction.objectStore(CHUNKS).getAll(chunksOf(name)))
	]);
	if (!manifest || parts.length !== manifest.hashes.length) return null;
	const bytes = joinChunks(await Promise.all(parts.map(async (part) => new Uint8Array(await part.arrayBuffer()))), manifest.size);
	return { bytes, saved: { chunkSize: manifest.chunkSize, hashes: manifest.hashes } };
}

/**
 * Saves `name`, writing only the chunks whose hash differs from `previous` (the result of the last
 * save of this file). Everything happens in one transaction, so a crash never leaves a manifest
 * that points at a mix of old and new chunks.
 */
export async function writeFile(
	name: string,
	snapshot: () => Uint8Array,
	chunkSize: number,
	previous: Saved | null
): Promise<{ saved: Saved; size: number; written: number }> {
	const transaction = (await store()).transaction([MANIFESTS, CHUNKS], 'readwrite');
	const done = finish(transaction);
	// Taken only after the await above and used without awaiting: the bytes may be a live view of
	// the database's memory, which could change while another worker request runs.
	const bytes = snapshot();
	const hashes = chunkHashes(bytes, chunkSize);
	const changed = changedChunks(previous?.chunkSize === chunkSize ? previous.hashes : null, hashes);
	const chunks = transaction.objectStore(CHUNKS);
	for (const index of changed) chunks.put(new Blob([bytes.slice(index * chunkSize, (index + 1) * chunkSize)]), [name, index]);
	// The database may have shrunk: drop chunks past the new end.
	chunks.delete(chunksOf(name, hashes.length));
	transaction.objectStore(MANIFESTS).put({ name, size: bytes.length, chunkSize, hashes } satisfies Manifest);
	await done;
	return { saved: { chunkSize, hashes }, size: bytes.length, written: changed.length };
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
