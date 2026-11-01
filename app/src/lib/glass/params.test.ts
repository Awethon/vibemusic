import { expect, it } from 'vitest';
import { decodeLabLink } from './params.ts';

const link = (bytes: number[]) =>
	btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');

it('reads frost from lab links in the lab’s 0.5 px steps, though the slider here is finer', () => {
	// Version 1, plain shape, Clear lens; only frost (10th field, bit 9) set, to 12 steps.
	const { params, preset } = decodeLabLink(`https://lab.example/#${link([1, 0, 0, 0x80, 0x04, 12])}`);
	expect(preset).toBe('clear');
	expect(params.frost).toBe(6);
});
