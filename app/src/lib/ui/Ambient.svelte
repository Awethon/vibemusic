<script lang="ts">
	import { prefersReducedMotion } from '../engine/dom.ts';
	import { currentLyricIndex, lyricsState } from '../player/lyricsState.svelte.ts';
	import { currentTrack } from '../player/player.svelte.ts';
	import { COVER_PX, LYRICS } from '../tuning.ts';
	import Cover from './Cover.svelte';

	const track = $derived(currentTrack());
	const line = $derived.by(() => {
		const lyrics = lyricsState.lyrics;
		const index = currentLyricIndex();
		return lyrics?.synced && index >= 0 ? lyrics.lines[index].text : '';
	});

	let shown = $state('');
	let swapping = $state(false);

	$effect(() => {
		const next = line;
		if (next === shown) return;
		swapping = true;
		const timer = setTimeout(
			() => {
				shown = next;
				swapping = false;
			},
			prefersReducedMotion() ? 0 : LYRICS.ambientSwapMs
		);
		return () => clearTimeout(timer);
	});
</script>

<section id="ambient" aria-hidden="true">
	<Cover albumId={track?.albumId} size={COVER_PX.ambient} eager />
	<div class="amb-text">
		<p class="amb-artist">{track ? `${track.artist} — ${track.album}` : ''}</p>
		<h2>{track?.title ?? ''}</h2>
		<p class="amb-line" class:swap={swapping}>{shown}</p>
	</div>
</section>
