// Kick-drum detector for the music-reactive background. It looks at the sub-bass band (30-65 Hz)
// in 128-sample blocks. A block becomes a candidate when it jumps above both a slow average and
// the last few blocks, and is above a floor of max(-24 dBFS, recent peak - 10 dB). About 20 ms
// later the candidate is confirmed over a 30 ms window: the sub band must be loud relative to the
// full mix and to 150-450 Hz (voice/guitar body), which rejects bass lines and low vocals.
// All numbers were tuned by ear against real tracks; shortcuts such as "always pass if strong"
// brought false hits back. Tests in kick.test.ts.

export const KICK_TUNING = Object.freeze({
	subLowHz: 30,
	subHighHz: 65,
	jumpDb: 8,
	riseDb: 6,
	slowTauSeconds: 0.15,
	minGapSeconds: 0.07,
	blockSize: 128,
	floorDb: -24,
	belowPeakDb: 10,
	strengthRangeDb: 16,
	peakDecayDbPerSecond: 1,
	referenceDb: -12,
	minVsMixDb: -5,
	minVsMidDb: -3,
	midLowHz: 150,
	midHighHz: 450,
	windowBeforeSeconds: 0.01,
	lookaheadSeconds: 0.02,
	recentBlocks: 4,
	ringBlocks: 64,
	minStrength: 0.2,
	silenceDb: -120
});

export type PcmSamples = ArrayLike<number>;

export type KickDetector = {
	readonly hits: number;
	reset(): void;
	process(sub: PcmSamples, from: number, to: number, mix: PcmSamples | null, mid: PcmSamples | null): number;
};

type PendingCandidate = { block: number; strength: number };

export function createKickDetector(sampleRate: number): KickDetector {
	const tuning = KICK_TUNING;
	const blockSeconds = tuning.blockSize / sampleRate;
	const blocksBefore = Math.round((tuning.windowBeforeSeconds * sampleRate) / tuning.blockSize);
	const blocksAfter = Math.round((tuning.lookaheadSeconds * sampleRate) / tuning.blockSize);
	const ring = tuning.ringBlocks;
	const subEnergy = new Float64Array(ring);
	const mixEnergy = new Float64Array(ring);
	const midEnergy = new Float64Array(ring);
	const recentDb = new Float32Array(tuning.recentBlocks).fill(tuning.silenceDb);
	const pending: PendingCandidate[] = [];
	let recentIndex = 0;
	let slowDb: number = tuning.silenceDb;
	let peakDb: number = tuning.silenceDb;
	let block = 0;
	let lastCandidate = -1e9;
	let lastAccepted = -1e9;
	let hits = 0;

	// Sums the confirmation window around the candidate block, which lies blocksAfter-1 blocks back.
	// `ring * 4` only keeps the index positive before the modulo.
	function windowEnergy(energy: Float64Array): number {
		let sum = 0;
		for (let offset = -blocksBefore; offset < blocksAfter; offset++) {
			sum += energy[(block - blocksAfter + 1 + offset + ring * 4) % ring];
		}
		return sum;
	}

	function judge(withMix: boolean, withMid: boolean): boolean {
		const sub = windowEnergy(subEnergy) + 1e-12;
		if (withMix && 10 * Math.log10(sub / (windowEnergy(mixEnergy) + 1e-12)) <= tuning.minVsMixDb) return false;
		if (withMid && 10 * Math.log10(sub / (windowEnergy(midEnergy) + 1e-12)) <= tuning.minVsMidDb) return false;
		return true;
	}

	return {
		get hits() {
			return hits;
		},
		reset() {
			recentDb.fill(tuning.silenceDb);
			pending.length = 0;
			slowDb = tuning.silenceDb;
			peakDb = tuning.silenceDb;
			lastCandidate = lastAccepted = block - 1e6;
		},
		process(sub, from, to, mix, mid) {
			let strongest = 0;
			for (let start = from; start + tuning.blockSize <= to; start += tuning.blockSize) {
				let subSquares = 0;
				let mixSquares = 0;
				let midSquares = 0;
				for (let index = start; index < start + tuning.blockSize; index++) {
					subSquares += sub[index] * sub[index];
					if (mix) mixSquares += mix[index] * mix[index];
					if (mid) midSquares += mid[index] * mid[index];
				}
				const slot = block % ring;
				subEnergy[slot] = subSquares;
				mixEnergy[slot] = mixSquares;
				midEnergy[slot] = midSquares;
				const db = 10 * Math.log10(subSquares / tuning.blockSize + 1e-12);
				let recentMin = recentDb[0];
				for (let index = 1; index < recentDb.length; index++) if (recentDb[index] < recentMin) recentMin = recentDb[index];
				const jump = db - slowDb;
				const rise = db - recentMin;
				peakDb = Math.max(db, peakDb - tuning.peakDecayDbPerSecond * blockSeconds);
				const floor = Math.max(tuning.floorDb, peakDb - tuning.belowPeakDb);
				const gapBlocks = tuning.minGapSeconds / blockSeconds;
				if (
					db > floor &&
					jump > tuning.jumpDb &&
					rise > tuning.riseDb &&
					block - lastCandidate > gapBlocks &&
					block - lastAccepted > gapBlocks
				) {
					// Strength is relative to the recent peak, but never to anything quieter than -12 dB,
					// so a quiet passage doesn't make every small kick a full hit.
					const reference = Math.max(peakDb, tuning.referenceDb);
					pending.push({
						block,
						strength: Math.min(1, Math.max(tuning.minStrength, 1 - (reference - db) / tuning.strengthRangeDb))
					});
					lastCandidate = block;
				}
				// Judge candidates once their look-ahead blocks have arrived.
				while (pending.length && block - pending[0].block >= blocksAfter - 1) {
					const candidate = pending.shift();
					if (!candidate) break;
					if (judge(mix !== null, mid !== null)) {
						lastAccepted = candidate.block;
						strongest = Math.max(strongest, candidate.strength);
						hits++;
					} else if (lastCandidate === candidate.block) {
						// A rejected candidate must not block a real kick that follows within the minimum gap.
						lastCandidate = -1e9;
					}
				}
				slowDb += (db - slowDb) * (1 - Math.exp(-blockSeconds / tuning.slowTauSeconds));
				recentDb[recentIndex] = db;
				recentIndex = (recentIndex + 1) % recentDb.length;
				block++;
			}
			return strongest;
		}
	};
}

// Two stages per side give a steeper slope than a single biquad.
export function createBandFilter(context: BaseAudioContext, input: AudioNode, lowHz: number, highHz: number): AudioNode {
	const stages: [BiquadFilterType, number][] = [
		['highpass', lowHz],
		['highpass', lowHz],
		['lowpass', highHz],
		['lowpass', highHz]
	];
	let node = input;
	for (const [type, hz] of stages) {
		const filter = context.createBiquadFilter();
		filter.type = type;
		filter.frequency.value = hz;
		node.connect(filter);
		node = filter;
	}
	return node;
}

export function createKickFilter(context: BaseAudioContext, input: AudioNode): AudioNode {
	const highpass = context.createBiquadFilter();
	highpass.type = 'highpass';
	highpass.frequency.value = KICK_TUNING.subLowHz;
	const firstLowpass = context.createBiquadFilter();
	firstLowpass.type = 'lowpass';
	firstLowpass.frequency.value = KICK_TUNING.subHighHz;
	const secondLowpass = context.createBiquadFilter();
	secondLowpass.type = 'lowpass';
	secondLowpass.frequency.value = KICK_TUNING.subHighHz;
	input.connect(highpass);
	highpass.connect(firstLowpass);
	firstLowpass.connect(secondLowpass);
	return secondLowpass;
}
