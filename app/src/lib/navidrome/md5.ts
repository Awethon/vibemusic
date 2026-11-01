// Plain MD5, needed for Subsonic token auth (md5(password + salt)). WebCrypto has no MD5.

const SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const CONSTANTS = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 2 ** 32) >>> 0);

function padded(text: string): DataView {
	const bytes = new TextEncoder().encode(text);
	const length = (((bytes.length + 8) >> 6) + 1) << 6;
	const buffer = new Uint8Array(length);
	buffer.set(bytes);
	buffer[bytes.length] = 0x80;
	const view = new DataView(buffer.buffer);
	view.setUint32(length - 8, (bytes.length * 8) >>> 0, true);
	view.setUint32(length - 4, Math.floor(bytes.length / 2 ** 29), true);
	return view;
}

export function md5(text: string): string {
	const view = padded(text);
	const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
	for (let block = 0; block < view.byteLength; block += 64) {
		let [a, b, c, d] = state;
		for (let step = 0; step < 64; step++) {
			const round = step >> 4;
			const mixed = round === 0 ? (b & c) | (~b & d) : round === 1 ? (d & b) | (~d & c) : round === 2 ? b ^ c ^ d : c ^ (b | ~d);
			const word = round === 0 ? step : round === 1 ? (5 * step + 1) % 16 : round === 2 ? (3 * step + 5) % 16 : (7 * step) % 16;
			const sum = (a + mixed + CONSTANTS[step] + view.getUint32(block + word * 4, true)) >>> 0;
			const shift = SHIFTS[round * 4 + (step % 4)];
			[a, d, c] = [d, c, b];
			b = (b + ((sum << shift) | (sum >>> (32 - shift)))) >>> 0;
		}
		state[0] = (state[0] + a) >>> 0;
		state[1] = (state[1] + b) >>> 0;
		state[2] = (state[2] + c) >>> 0;
		state[3] = (state[3] + d) >>> 0;
	}
	return state.map((word) => [0, 8, 16, 24].map((offset) => ((word >>> offset) & 0xff).toString(16).padStart(2, '0')).join('')).join('');
}
