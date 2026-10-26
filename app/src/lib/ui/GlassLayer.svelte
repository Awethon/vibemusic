<script lang="ts">
	import { untrack } from 'svelte';
	import { startGlassLayer } from '../glass/layer.ts';
	import { glass } from '../glass/settings.svelte.ts';

	let canvas = $state<HTMLCanvasElement | null>(null);

	$effect(() => {
		const target = canvas;
		if (!target || !glass.enabled) return;
		const stop = untrack(() => startGlassLayer(target, () => glass.params));
		if (!stop) return;
		document.body.classList.add('glass-on');
		return () => {
			stop();
			document.body.classList.remove('glass-on');
		};
	});
</script>

{#if glass.enabled}<canvas id="glass" aria-hidden="true" bind:this={canvas}></canvas>{/if}
