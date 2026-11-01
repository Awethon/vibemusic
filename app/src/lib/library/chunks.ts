function hashRange(bytes: Uint8Array, start: number, end: number): string {
	let first = 0x811c9dc5 ^ (end - start);
	let second = 0x9e3779b9;
	const aligned = (bytes.byteOffset + start) % 4 === 0;
	const words = aligned ? new Uint32Array(bytes.buffer, bytes.byteOffset + start, (end - start) >>> 2) : null;
	const wordCount = (end - start) >>> 2;
	for (let index = 0; index < wordCount; index++) {
		const offset = start + index * 4;
		const word = words ? words[index] : bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
		first = Math.imul(first ^ word, 0x01000193);
		second = Math.imul(second ^ word, 0x85ebca6b) ^ (second >>> 13);
	}
	for (let offset = start + wordCount * 4; offset < end; offset++) {
		first = Math.imul(first ^ bytes[offset], 0x01000193);
		second = Math.imul(second ^ bytes[offset], 0x85ebca6b) ^ (second >>> 13);
	}
	return (first >>> 0).toString(16).padStart(8, '0') + (second >>> 0).toString(16).padStart(8, '0');
}

export function chunkHashes(bytes: Uint8Array, chunkSize: number): string[] {
	const hashes: string[] = [];
	for (let start = 0; start < bytes.length; start += chunkSize) hashes.push(hashRange(bytes, start, Math.min(bytes.length, start + chunkSize)));
	return hashes;
}

export function changedChunks(previous: readonly string[] | null, next: readonly string[]): number[] {
	return next.flatMap((hash, index) => (previous?.[index] === hash ? [] : [index]));
}

export function joinChunks(parts: readonly Uint8Array[], size: number): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const part of parts) {
		bytes.set(part, offset);
		offset += part.length;
	}
	if (offset !== size) throw new Error('Library chunks are incomplete');
	return bytes;
}
