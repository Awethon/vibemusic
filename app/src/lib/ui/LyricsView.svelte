<script lang="ts">
	import { currentLineIndex, lyricsFor, type Lyrics } from '../player/lyrics.ts';
	import { currentTrack, player, seekTo, togglePlay } from '../player/player.svelte.ts';

	let { focusRatio = 0.35, large = false }: { focusRatio?: number; large?: boolean } = $props();

	let lyrics = $state<Lyrics | null>(null);
	let loading = $state(false);
	let container = $state<HTMLElement | null>(null);
	const trackId = $derived(currentTrack()?.id ?? '');
	const current = $derived(currentLineIndex(lyrics, player.position));

	$effect(() => {
		const id = trackId;
		lyrics = null;
		if (!id) return;
		loading = true;
		let active = true;
		void lyricsFor(id).then((result) => {
			if (!active) return;
			lyrics = result;
			loading = false;
		});
		return () => {
			active = false;
		};
	});

	$effect(() => {
		if (!container || current < 0) return;
		const line = container.children[current] as HTMLElement | undefined;
		if (!line) return;
		container.scrollTo({ top: line.offsetTop - container.clientHeight * focusRatio, behavior: 'smooth' });
	});

	function seekToLine(start: number | null) {
		if (start === null) return;
		seekTo(start);
		if (!player.playing) togglePlay();
	}
</script>

{#if lyrics}
	<div class="lyrics" class:large class:synced={lyrics.synced} bind:this={container}>
		{#each lyrics.lines as line, index (index)}
			<button
				class="line selectable"
				class:on={index === current}
				class:near={Math.abs(index - current) === 1}
				class:past={current >= 0 && index < current - 1}
				disabled={line.start === null}
				onclick={() => seekToLine(line.start)}>{line.text || '♪'}</button
			>
		{/each}
	</div>
{:else}
	<p class="empty-state">{loading ? 'Loading lyrics…' : trackId ? 'No lyrics for this track.' : 'Nothing playing.'}</p>
{/if}
