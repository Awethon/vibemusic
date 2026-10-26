import { describe, expect, it } from 'vitest';
import { createKickDetector, KICK_TUNING } from './kick';

const sampleRate = 48000;
const chunkSize = KICK_TUNING.blockSize * 6;

function synthesize(seconds: number, amplitudeAt: (time: number) => number, hz = 50): Float32Array {
	const samples = new Float32Array(Math.round(seconds * sampleRate));
	for (let index = 0; index < samples.length; index++) {
		const time = index / sampleRate;
		samples[index] = amplitudeAt(time) * Math.sin(2 * Math.PI * hz * time);
	}
	return samples;
}

function hitTimes(sub: Float32Array, mix: Float32Array | null = null): number[] {
	const detector = createKickDetector(sampleRate);
	const times: number[] = [];
	for (let from = 0; from + chunkSize <= sub.length; from += chunkSize) {
		const before = detector.hits;
		detector.process(sub, from, from + chunkSize, mix, null);
		if (detector.hits > before) times.push(from / sampleRate);
	}
	return times;
}

const burstStarts = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0];

function burstTrain(time: number): number {
	let amplitude = 0;
	for (const start of burstStarts) if (time >= start) amplitude = 0.6 * Math.exp(-(time - start) / 0.04);
	return amplitude;
}

describe('createKickDetector', () => {
	it('fires once per decaying sub-bass burst over silence', () => {
		const times = hitTimes(synthesize(3.6, burstTrain));
		expect(times).toHaveLength(burstStarts.length);
		times.forEach((time, index) => {
			expect(time).toBeGreaterThanOrEqual(burstStarts[index]);
			expect(time).toBeLessThan(burstStarts[index] + 0.05);
		});
	});

	it('stops firing on a steady tone once it has settled', () => {
		const times = hitTimes(synthesize(4, (time) => (time >= 0.5 ? 0.6 : 0)));
		expect(times[0]).toBeGreaterThanOrEqual(0.5);
		expect(times.filter((time) => time > 1.1)).toEqual([]);
	});

	it('does not fire on a slow swell', () => {
		expect(hitTimes(synthesize(4, (time) => 0.6 * Math.pow(10, (-40 + 10 * time) / 20)))).toEqual([]);
	});

	it('rejects bursts buried under a much louder full mix', () => {
		const sub = synthesize(3.6, burstTrain);
		const loud = synthesize(3.6, () => 1.5, 1000);
		const mix = sub.map((value, index) => value + loud[index]);
		expect(hitTimes(sub, mix)).toEqual([]);
	});

	it('forgets the previous track after reset', () => {
		const detector = createKickDetector(sampleRate);
		const sub = synthesize(0.9, burstTrain);
		detector.process(sub, 0, sub.length - (sub.length % KICK_TUNING.blockSize), null, null);
		expect(detector.hits).toBe(1);
		detector.reset();
		detector.process(sub, 0, sub.length - (sub.length % KICK_TUNING.blockSize), null, null);
		expect(detector.hits).toBe(2);
	});
});
