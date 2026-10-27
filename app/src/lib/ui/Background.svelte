<script lang="ts">
	import { idle } from '../engine/idle.svelte.ts';
	import { attachField, followTrackPalette } from '../engine/palette.ts';
	import { albumPalette } from '../library/palette.ts';
	import { audioLive, currentTrack, sampleAudio } from '../player/player.svelte.ts';
	import { FIELD, PALETTE } from '../tuning.ts';
	import { createField, type Field } from '../visual/field.ts';
	import { copyField } from '../visual/fieldSnapshot.ts';
	import type { Rgb } from '../color.ts';
	import { accentFromPalette, blendAccent } from './accent.ts';
	import { ui } from './state.svelte.ts';
	import { scrimBackground } from './scrim.ts';

	let canvas = $state<HTMLCanvasElement | null>(null);
	let accent: Rgb = [217, 200, 255];
	let accentTarget: Rgb = accent;
	const albumId = $derived(currentTrack()?.albumId ?? '');

	$effect(() => {
		const id = albumId;
		if (!id) return;
		followTrackPalette(id);
		let current = true;
		void albumPalette(id)
			.then((colors) => {
				if (current) accentTarget = accentFromPalette(colors) ?? accentTarget;
			})
			.catch(() => {});
		return () => {
			current = false;
		};
	});

	$effect(() => {
		if (!canvas) return;
		let field: Field | null = null;
		let destroyed = false;
		let frame = 0;
		let lastFrame = performance.now();
		let lastDraw = 0;
		let intensity: number = FIELD.initialIntensity;
		const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
		const loop = (now: number) => {
			frame = requestAnimationFrame(loop);
			const seconds = Math.min((now - lastFrame) / 1000, FIELD.maxFrameSeconds);
			lastFrame = now;
			const blended = blendAccent(accent, accentTarget, 1 - Math.exp(-seconds * PALETTE.trackChangeRate));
			if (blended.some((channel, index) => channel !== accent[index])) {
				accent = blended;
				document.documentElement.style.setProperty('--accent', `rgb(${accent.map(Math.round).join(' ')})`);
			}
			if (!field) return;
			const features = audioLive() ? sampleAudio(now) : null;
			const target = idle.isIdle || ui.fullScreen ? FIELD.focusedIntensity : FIELD.browsingIntensity;
			intensity += (target - intensity) * (1 - Math.exp(-seconds * FIELD.intensityFollowRate));
			if (reducedMotion.matches && now - lastDraw <= FIELD.reducedMotionFrameIntervalMs) return;
			lastDraw = now;
			field.frame(now, features, { intensity, ripples: ui.ripples ? 1 : 0 });
			if (canvas && document.body.classList.contains('glass-on')) copyField(canvas, now);
		};
		const start = () => {
			if (frame) return;
			lastFrame = performance.now();
			frame = requestAnimationFrame(loop);
		};
		const stop = () => {
			cancelAnimationFrame(frame);
			frame = 0;
		};
		const onVisibility = () => (document.hidden ? stop() : start());
		const onResize = () => field?.resize();
		void createField(canvas)
			.then((created) => {
				if (destroyed) return created.destroy();
				field = created;
				ui.fieldRenderer = created.renderer;
				attachField(created);
			})
			.catch(() => (ui.fieldRenderer = 'none'));
		start();
		document.addEventListener('visibilitychange', onVisibility);
		addEventListener('resize', onResize);
		return () => {
			destroyed = true;
			stop();
			document.removeEventListener('visibilitychange', onVisibility);
			removeEventListener('resize', onResize);
			attachField(null);
			field?.destroy();
		};
	});
</script>

<canvas id="field" aria-hidden="true" bind:this={canvas}></canvas>
<div id="scrim" aria-hidden="true" style:background={scrimBackground()}></div>
