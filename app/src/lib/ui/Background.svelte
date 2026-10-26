<script lang="ts">
	import { albumPalette } from '../library/palette.ts';
	import { audioLive, currentTrack, sampleAudio } from '../player/player.svelte.ts';
	import { createField, type Field } from '../visual/field.ts';
	import { FIELD, PALETTE } from '../tuning.ts';
	import { accentFromPalette, blendAccent, type Rgb } from './accent.ts';
	import { ui } from './state.svelte.ts';

	let canvas = $state<HTMLCanvasElement | null>(null);
	let field: Field | null = null;
	let accent: Rgb = [235, 235, 235];
	let accentTarget: Rgb = accent;
	let intensity: number = FIELD.initialIntensity;
	let palette: string[] = [];
	const albumId = $derived(currentTrack()?.albumId ?? '');

	$effect(() => {
		const id = albumId;
		if (!id) return;
		let current = true;
		void albumPalette(id)
			.then((colors) => {
				if (!current || !colors.length) return;
				palette = colors;
				field?.setPalette(colors, { rate: PALETTE.trackChangeRate });
				accentTarget = accentFromPalette(colors) ?? accentTarget;
			})
			.catch(() => {});
		return () => {
			current = false;
		};
	});

	$effect(() => {
		if (!canvas) return;
		let frame = 0;
		let lastFrame = performance.now();
		let lastDraw = 0;
		const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
		let destroyed = false;
		const loop = (now: number) => {
			frame = requestAnimationFrame(loop);
			const seconds = Math.min((now - lastFrame) / 1000, FIELD.maxFrameSeconds);
			lastFrame = now;
			accent = blendAccent(accent, accentTarget, 1 - Math.exp(-seconds * PALETTE.trackChangeRate));
			document.documentElement.style.setProperty('--accent', `rgb(${accent.map(Math.round).join(' ')})`);
			if (!field) return;
			const features = audioLive() ? sampleAudio(now) : null;
			const target = ui.fullScreen ? FIELD.focusedIntensity : FIELD.browsingIntensity;
			intensity += (target - intensity) * (1 - Math.exp(-seconds * FIELD.intensityFollowRate));
			if (reducedMotion.matches && now - lastDraw < FIELD.reducedMotionFrameIntervalMs) return;
			lastDraw = now;
			field.frame(now, features, { intensity, ripples: ui.ripples ? 1 : 0 });
		};
		void createField(canvas)
			.then((created) => {
				if (destroyed) return created.destroy();
				field = created;
				ui.fieldRenderer = created.renderer;
				if (palette.length) created.setPalette(palette, { instant: true });
			})
			.catch(() => (ui.fieldRenderer = 'none'));
		frame = requestAnimationFrame(loop);
		const onResize = () => field?.resize();
		window.addEventListener('resize', onResize);
		return () => {
			destroyed = true;
			cancelAnimationFrame(frame);
			window.removeEventListener('resize', onResize);
			field?.destroy();
			field = null;
		};
	});
</script>

<canvas class="field" bind:this={canvas}></canvas>
