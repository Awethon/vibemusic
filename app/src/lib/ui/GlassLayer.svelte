<script lang="ts">
	import { untrack } from 'svelte';
	import { startGlassLayer, type GlassLevel } from '../glass/layer.ts';
	import { glass } from '../glass/settings.svelte.ts';

	let { level }: { level: GlassLevel } = $props();
	let canvas = $state<HTMLCanvasElement | null>(null);

	$effect(() => {
		const target = canvas;
		if (!target || !glass.enabled) return;
		const stop = untrack(() => startGlassLayer(target, level, () => glass.params));
		if (!stop) return;
		if (level === 'player') document.body.classList.add('glass-on');
		return () => {
			stop();
			if (level === 'player') document.body.classList.remove('glass-on');
		};
	});
</script>

{#if glass.enabled}<canvas id="glass-{level}" class="glass-layer" aria-hidden="true" bind:this={canvas}></canvas>{/if}
