import { createBandFilter, createKickDetector, createKickFilter, KICK_TUNING } from './kick';

export const ANALYSIS_TUNING = Object.freeze({
	fftSize: 2048,
	outputDelaySeconds: 0.035,
	kick: KICK_TUNING,
	bands: 32,
	bandMinHz: 40,
	bandMaxHz: 12000,
	bandAttackSeconds: 0.03,
	bandReleaseSeconds: 0.25,
	spectrumReferenceFloor: 0.35,
	spectrumReferenceDecaySeconds: 8,
	levelFloorDb: -48,
	levelRangeDb: 42,
	gateFloor: 0.05,
	gateRange: 0.15,
	shortPowerTauSeconds: 0.25,
	longPowerTauSeconds: 6,
	relativeRangeDb: 12,
	intensityAttackSeconds: 0.1,
	intensityReleaseSeconds: 0.5,
	loudnessAttackSeconds: 0.08,
	loudnessReleaseSeconds: 0.6,
	onsetDecaySeconds: 0.18,
	bandSplitAttackSeconds: 0.05,
	bandSplitReleaseSeconds: 0.3,
	bassEndHz: 150,
	midEndHz: 2000,
	trebleEndHz: 8000,
	maxFrameSeconds: 0.1,
	minFrameSeconds: 0.001,
	defaultFrameSeconds: 0.016
});

export const OUTPUT_DELAY_SECONDS = ANALYSIS_TUNING.outputDelaySeconds;

export type AudioFeatures = {
	loudness: number;
	intensity: number;
	level: number;
	onset: number;
	beats: number;
	bass: number;
	mid: number;
	treble: number;
	spectrum: Float32Array<ArrayBuffer>;
	real: boolean;
};

export type Analysis = {
	readonly features: Readonly<AudioFeatures>;
	sample(nowMs: number, playing: boolean): Readonly<AudioFeatures>;
	reset(): void;
	disconnect(): void;
};

export type SyntheticPlayback = {
	positionSeconds: number;
	playing: boolean;
	trackId: string | null;
};

export type SyntheticAnalysis = {
	readonly features: Readonly<AudioFeatures>;
	sample(nowMs: number, playback: SyntheticPlayback): Readonly<AudioFeatures>;
};

export function createIdleFeatures(): AudioFeatures {
	return {
		loudness: 0,
		intensity: 0,
		level: 0,
		onset: 0,
		beats: 0,
		bass: 0,
		mid: 0,
		treble: 0,
		spectrum: new Float32Array(ANALYSIS_TUNING.bands),
		real: false
	};
}

function smooth(previous: number, next: number, dt: number, attack: number, release: number): number {
	const tau = next > previous ? attack : release;
	return previous + (next - previous) * (1 - Math.exp(-dt / tau));
}

function createFrameClock() {
	let lastSampleAt = 0;
	return (nowMs: number): number => {
		const now = nowMs / 1000;
		const dt = Math.min(
			ANALYSIS_TUNING.maxFrameSeconds,
			Math.max(ANALYSIS_TUNING.minFrameSeconds, now - (lastSampleAt || now - ANALYSIS_TUNING.defaultFrameSeconds))
		);
		lastSampleAt = now;
		return dt;
	};
}

export function createAnalysis(context: BaseAudioContext, input: AudioNode): Analysis {
	const tuning = ANALYSIS_TUNING;
	const bands = tuning.bands;
	const features = createIdleFeatures();
	const nextFrameSeconds = createFrameClock();

	const analyser = context.createAnalyser();
	analyser.fftSize = tuning.fftSize;
	analyser.smoothingTimeConstant = 0;
	input.connect(analyser);

	const kickAnalyser = context.createAnalyser();
	kickAnalyser.fftSize = tuning.fftSize;
	const kickFilter = createKickFilter(context, input);
	kickFilter.connect(kickAnalyser);
	const kickWave = new Float32Array(kickAnalyser.fftSize);

	const midAnalyser = context.createAnalyser();
	midAnalyser.fftSize = tuning.fftSize;
	const midFilter = createBandFilter(context, input, tuning.kick.midLowHz, tuning.kick.midHighHz);
	midFilter.connect(midAnalyser);
	const midWave = new Float32Array(midAnalyser.fftSize);

	const kickDetector = createKickDetector(context.sampleRate);
	const frequencyBins = new Uint8Array(analyser.frequencyBinCount);
	const wave = new Float32Array(analyser.fftSize);
	const binHz = context.sampleRate / analyser.fftSize;
	const bandFrom = new Uint16Array(bands);
	const bandTo = new Uint16Array(bands);
	const bandEnvelope = new Float32Array(bands);
	for (let band = 0; band < bands; band++) {
		const lowHz = tuning.bandMinHz * Math.pow(tuning.bandMaxHz / tuning.bandMinHz, band / bands);
		const highHz = tuning.bandMinHz * Math.pow(tuning.bandMaxHz / tuning.bandMinHz, (band + 1) / bands);
		bandFrom[band] = Math.max(1, Math.floor(lowHz / binHz));
		bandTo[band] = Math.max(bandFrom[band] + 1, Math.ceil(highHz / binHz));
	}
	const bassEnd = Math.round(tuning.bassEndHz / binHz);
	const midEnd = Math.round(tuning.midEndHz / binHz);
	const trebleEnd = Math.min(frequencyBins.length, Math.round(tuning.trebleEndHz / binHz));

	let spectrumReference: number = tuning.spectrumReferenceFloor;
	let shortPower = 0;
	let longPower = 0;

	function bandAverage(from: number, to: number): number {
		let sum = 0;
		for (let bin = from; bin < to; bin++) sum += frequencyBins[bin];
		return sum / ((to - from) * 255);
	}

	function updateSpectrum(dt: number, gate: number) {
		let frameMax = 0;
		for (let band = 0; band < bands; band++) {
			let sum = 0;
			for (let bin = bandFrom[band]; bin < bandTo[band]; bin++) sum += frequencyBins[bin];
			const raw = sum / ((bandTo[band] - bandFrom[band]) * 255);
			bandEnvelope[band] = smooth(bandEnvelope[band], raw, dt, tuning.bandAttackSeconds, tuning.bandReleaseSeconds);
			if (bandEnvelope[band] > frameMax) frameMax = bandEnvelope[band];
		}
		spectrumReference = Math.max(
			tuning.spectrumReferenceFloor,
			frameMax,
			spectrumReference * Math.exp(-dt / tuning.spectrumReferenceDecaySeconds)
		);
		for (let band = 0; band < bands; band++) {
			features.spectrum[band] = Math.min(1, bandEnvelope[band] / spectrumReference) * gate;
		}
	}

	function sample(nowMs: number, playing: boolean): Readonly<AudioFeatures> {
		const dt = nextFrameSeconds(nowMs);
		analyser.getFloatTimeDomainData(wave);
		let squares = 0;
		for (let index = 0; index < wave.length; index++) squares += wave[index] * wave[index];
		const rms = Math.sqrt(squares / wave.length);
		const db = 20 * Math.log10(rms + 1e-6);
		const level = Math.min(1, Math.max(0, (db - tuning.levelFloorDb) / tuning.levelRangeDb));

		analyser.getByteFrequencyData(frequencyBins);
		let impulse = 0;
		if (playing) {
			kickAnalyser.getFloatTimeDomainData(kickWave);
			const fresh = Math.min(kickWave.length, Math.round(context.sampleRate * dt));
			const hitsBefore = kickDetector.hits;
			analyser.getFloatTimeDomainData(wave);
			midAnalyser.getFloatTimeDomainData(midWave);
			impulse = kickDetector.process(kickWave, kickWave.length - fresh, kickWave.length, wave, midWave);
			features.beats += kickDetector.hits - hitsBefore;
		}

		const gate = Math.min(1, Math.max(0, (level - tuning.gateFloor) / tuning.gateRange));
		let relative = 0;
		if (playing) {
			const power = rms * rms;
			shortPower += (power - shortPower) * (1 - Math.exp(-dt / tuning.shortPowerTauSeconds));
			longPower = longPower ? longPower + (power - longPower) * (1 - Math.exp(-dt / tuning.longPowerTauSeconds)) : power;
			relative =
				Math.min(1, Math.max(0, 0.5 + (10 * Math.log10((shortPower + 1e-9) / (longPower + 1e-9))) / tuning.relativeRangeDb)) * gate;
		}
		features.intensity = smooth(features.intensity, relative, dt, tuning.intensityAttackSeconds, tuning.intensityReleaseSeconds);

		features.level = playing ? level : 0;
		features.loudness = smooth(features.loudness, features.level, dt, tuning.loudnessAttackSeconds, tuning.loudnessReleaseSeconds);
		features.onset = Math.max(impulse, features.onset * Math.exp(-dt / tuning.onsetDecaySeconds));
		features.bass = smooth(features.bass, bandAverage(1, bassEnd), dt, tuning.bandSplitAttackSeconds, tuning.bandSplitReleaseSeconds);
		features.mid = smooth(features.mid, bandAverage(bassEnd, midEnd), dt, tuning.bandSplitAttackSeconds, tuning.bandSplitReleaseSeconds);
		features.treble = smooth(
			features.treble,
			bandAverage(midEnd, trebleEnd),
			dt,
			tuning.bandSplitAttackSeconds,
			tuning.bandSplitReleaseSeconds
		);
		updateSpectrum(dt, playing ? gate : 0);
		features.real = true;
		return features;
	}

	return {
		features,
		sample,
		reset() {
			longPower = 0;
			kickDetector.reset();
		},
		disconnect() {
			input.disconnect(analyser);
			kickFilter.disconnect();
			midFilter.disconnect();
			analyser.disconnect();
			kickAnalyser.disconnect();
			midAnalyser.disconnect();
		}
	};
}

function hashTrackId(text: string): number {
	let hash = 2166136261;
	for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
	return hash >>> 0;
}

export function createSyntheticAnalysis(): SyntheticAnalysis {
	const tuning = ANALYSIS_TUNING;
	const bands = ANALYSIS_TUNING.bands;
	const features = createIdleFeatures();
	const nextFrameSeconds = createFrameClock();

	function sample(nowMs: number, playback: SyntheticPlayback): Readonly<AudioFeatures> {
		const dt = nextFrameSeconds(nowMs);
		const position = playback.positionSeconds;
		const bpm = 84 + ((hashTrackId(playback.trackId ?? 'x') % 48) | 0);
		const phase = ((position * bpm) / 60) % 1;
		const section = 0.55 + 0.45 * Math.sin(position * 0.09) * Math.sin(position * 0.031 + 1.1);
		const on = playback.playing;
		const level = on ? Math.max(0, section * (0.6 + 0.4 * Math.exp(-phase * 5))) : 0;
		let impulse = 0;
		if (on && phase < dt * (bpm / 60) * 1.01 && section > 0.35) {
			impulse = 0.4 + 0.6 * section;
			features.beats++;
		}
		features.level = level;
		features.loudness = smooth(features.loudness, level, dt, tuning.loudnessAttackSeconds, tuning.loudnessReleaseSeconds);
		features.intensity = smooth(features.intensity, on ? 0.2 + 0.7 * section : 0, dt, tuning.intensityAttackSeconds, tuning.intensityReleaseSeconds);
		features.onset = Math.max(impulse, features.onset * Math.exp(-dt / tuning.onsetDecaySeconds));
		features.bass = smooth(features.bass, on ? section * Math.exp(-phase * 4) : 0, dt, tuning.bandSplitAttackSeconds, tuning.bandSplitReleaseSeconds);
		features.mid = smooth(features.mid, on ? 0.4 * section : 0, dt, tuning.bandSplitAttackSeconds, tuning.bandSplitReleaseSeconds);
		features.treble = smooth(features.treble, on ? 0.25 * section : 0, dt, tuning.bandSplitAttackSeconds, tuning.bandSplitReleaseSeconds);
		for (let band = 0; band < bands; band++) {
			const x = band / (bands - 1);
			const shape =
				features.bass * Math.exp(-x * 6) + features.mid * Math.exp(-((x - 0.45) ** 2) * 18) + features.treble * x * 0.8;
			features.spectrum[band] = Math.min(1, shape * (0.85 + 0.15 * Math.sin(position * 1.3 + band)));
		}
		features.real = false;
		return features;
	}

	return { features, sample };
}
