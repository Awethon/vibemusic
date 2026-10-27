const SCRIM = Object.freeze({
	rgb: '6, 5, 9',
	edgeAlpha: 0.5,
	nearAlpha: 0.12,
	nearPx: 360,
	fadeEndRatio: 0.6,
	bottomFromRatio: 0.55,
	bottomAlpha: 0.4
});

const shade = (alpha: number) => `rgba(${SCRIM.rgb}, ${alpha})`;
const percent = (ratio: number) => `${ratio * 100}%`;

export const scrimBackground = () =>
	`linear-gradient(90deg, ${shade(SCRIM.edgeAlpha)} 0, ${shade(SCRIM.nearAlpha)} ${SCRIM.nearPx}px, ${shade(0)} ${percent(SCRIM.fadeEndRatio)}), ` +
	`linear-gradient(180deg, ${shade(0)} ${percent(SCRIM.bottomFromRatio)}, ${shade(SCRIM.bottomAlpha)} 100%)`;

export function paintScrim(context: CanvasRenderingContext2D, width: number, height: number) {
	const across = context.createLinearGradient(0, 0, width, 0);
	across.addColorStop(0, shade(SCRIM.edgeAlpha));
	across.addColorStop(Math.min(SCRIM.nearPx / width, SCRIM.fadeEndRatio), shade(SCRIM.nearAlpha));
	across.addColorStop(SCRIM.fadeEndRatio, shade(0));
	context.fillStyle = across;
	context.fillRect(0, 0, width, height);
	const down = context.createLinearGradient(0, 0, 0, height);
	down.addColorStop(SCRIM.bottomFromRatio, shade(0));
	down.addColorStop(1, shade(SCRIM.bottomAlpha));
	context.fillStyle = down;
	context.fillRect(0, 0, width, height);
}
