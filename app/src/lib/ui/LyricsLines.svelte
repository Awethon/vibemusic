<script lang="ts">
	import { registerLyricView } from '../engine/layout.svelte.ts';
	import { currentLyricIndex, lyricsState } from '../player/lyricsState.svelte.ts';
	import { player, seekTo, togglePlay } from '../player/player.svelte.ts';

	let {
		outerClass,
		innerClass,
		outerId,
		focusRatio,
		visible
	}: { outerClass: string; innerClass: string; outerId?: string; focusRatio: number; visible: boolean } = $props();

	let box = $state<HTMLElement | null>(null);
	let lines = $state<HTMLElement | null>(null);
	const lyrics = $derived(lyricsState.lyrics);
	const current = $derived(currentLyricIndex());

	function recenter() {
		if (!visible || !box || !lines || (lyrics && !lyrics.synced)) return;
		const focused = lines.children[lyrics ? current : 0] as HTMLElement | undefined;
		if (!focused || !box.clientHeight) return;
		const offset = Math.round(box.clientHeight * focusRatio - focused.offsetTop - focused.offsetHeight / 2);
		lines.style.transform = `translateY(${offset}px)`;
	}

	$effect(() => registerLyricView(recenter));

	$effect(() => {
		void current;
		void visible;
		void lyrics;
		void lyricsState.loading;
		requestAnimationFrame(recenter);
	});

	// A new track starts at the top without gliding there from the old song's position; the
	// transition comes back on the next frame.
	$effect(() => {
		void lyricsState.trackId;
		if (!lines) return;
		lines.style.transition = 'none';
		lines.style.transform = 'translateY(0px)';
		const frame = requestAnimationFrame(() => {
			if (lines) lines.style.transition = '';
			recenter();
		});
		return () => cancelAnimationFrame(frame);
	});

	function seekToLine(start: number | null) {
		if (start === null) return;
		seekTo(start);
		if (!player.playing) togglePlay();
	}
</script>

<div class={outerClass} id={outerId} bind:this={box} style:overflow-y={lyrics && !lyrics.synced ? 'auto' : undefined}>
	<div class={innerClass} bind:this={lines}>
		{#if lyrics}
			{#each lyrics.lines as line, index (index)}
				<p
					class:on={!lyrics.synced || index === current}
					class:past={lyrics.synced && index < current}
					class:near={lyrics.synced && (index === current - 1 || index === current + 1)}
					onclick={() => seekToLine(line.start)}
					role="presentation"
				>
					{line.text || '♪'}
				</p>
			{/each}
		{:else if lyricsState.trackId && !lyricsState.loading}
			<p class="near">No lyrics for this track</p>
		{/if}
	</div>
</div>
