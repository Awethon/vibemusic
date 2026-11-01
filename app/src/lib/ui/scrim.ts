import { formFactor } from './formFactor.svelte.ts';

const SCRIM = Object.freeze({
	rgb: '6, 5, 9',
	edgeAlpha: 0.5,
	nearAlpha: 0.12,
	nearPx: 360,
	fadeEndRatio: 0.6,
	bottomFromRatio: 0.55,
	bottomAlpha: 0.4,
	phone: { topAlpha: 0.3, topEndRatio: 0.35, bottomFromRatio: 0.6, bottomAlpha: 0.45 }
});

type Stop = [ratio: number, alpha: number];
type Layer = { vertical: boolean; stops: Stop[] };

const shade = (alpha: number) => `rgba(${SCRIM.rgb}, ${alpha})`;

function layers(width: number): Layer[] {
	if (formFactor.phone) {
		const { topAlpha, topEndRatio, bottomFromRatio, bottomAlpha } = SCRIM.phone;
		return [
			{
				vertical: true,
				stops: [
					[0, topAlpha],
					[topEndRatio, 0],
					[bottomFromRatio, 0],
					[1, bottomAlpha]
				]
			}
		];
	}
	return [
		{
			vertical: false,
			stops: [
				[0, SCRIM.edgeAlpha],
				[Math.min(SCRIM.nearPx / width, SCRIM.fadeEndRatio), SCRIM.nearAlpha],
				[SCRIM.fadeEndRatio, 0]
			]
		},
		{
			vertical: true,
			stops: [
				[SCRIM.bottomFromRatio, 0],
				[1, SCRIM.bottomAlpha]
			]
		}
	];
}

export const scrimBackground = (width: number) =>
	layers(width)
		.map(
			({ vertical, stops }) =>
				`linear-gradient(${vertical ? 180 : 90}deg, ${stops.map(([ratio, alpha]) => `${shade(alpha)} ${ratio * 100}%`).join(', ')})`
		)
		.join(', ');

export function paintScrim(context: CanvasRenderingContext2D, width: number, height: number) {
	for (const { vertical, stops } of layers(width)) {
		const gradient = vertical ? context.createLinearGradient(0, 0, 0, height) : context.createLinearGradient(0, 0, width, 0);
		for (const [ratio, alpha] of stops) gradient.addColorStop(ratio, shade(alpha));
		context.fillStyle = gradient;
		context.fillRect(0, 0, width, height);
	}
}
