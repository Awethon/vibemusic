<script lang="ts">
	import { albumById } from '../library/queries.ts';
	import { currentTrack, playerQueue } from '../player/player.svelte.ts';
	import { LYRICS, QUEUE } from '../tuning.ts';
	import Cover from './Cover.svelte';
	import Icon from './Icon.svelte';
	import LikeButton from './LikeButton.svelte';
	import { live } from './live.svelte.ts';
	import LyricsLines from './LyricsLines.svelte';
	import QueueRow from './QueueRow.svelte';
	import { playUpNextRow } from './queueActions.ts';
	import { setFullScreen, togglePanel } from './shell.ts';
	import { ui } from './state.svelte.ts';
	import TrackLinks from './TrackLinks.svelte';

	const track = $derived(currentTrack());
	const album = live(() => (track ? albumById(track.albumId) : Promise.resolve(null)), null);
	const rows = $derived.by(() => {
		const limit = QUEUE.fullScreenUpNextCount;
		const queued = playerQueue().userQueue.slice(0, limit).map((entry, index) => ({ entry, queuedIndex: index as number | undefined, sourceIndex: undefined as number | undefined }));
		const upcoming = playerQueue().sourceQueue
			.slice(playerQueue().sourceIndex + 1, playerQueue().sourceIndex + 1 + limit)
			.map((entry, index) => ({ entry, queuedIndex: undefined as number | undefined, sourceIndex: playerQueue().sourceIndex + 1 + index }));
		return [...queued, ...upcoming].slice(0, limit);
	});

	function playRow(event: MouseEvent) {
		const row = (event.target as Element).closest<HTMLElement>('li');
		if (row) playUpNextRow(row);
	}
</script>

<section id="now" aria-label="Now playing">
	<div class="np">
		<div class="np-left">
			<div class="np-cover"><Cover albumId={track?.albumId} size={800} eager /></div>
			<div class="np-meta">
				<h1>{track?.title ?? ''}</h1>
				<p>{#if track}<TrackLinks {track} year={album.value?.year ?? 0} />{/if}</p>
				<LikeButton />
			</div>
		</div>
		<LyricsLines outerClass="np-lyrics" innerClass="lyr" outerId="npLyrics" focusRatio={LYRICS.focusLineRatio.canvas} visible={ui.fullScreen && ui.fullScreenStyle === 'canvas'} />
		<aside class="np-next">
			<p class="eyebrow">Up next</p>
			<ol id="npNext" onclick={playRow} role="presentation">
				{#each rows as row (row.entry.entryId)}<QueueRow entry={row.entry} queuedIndex={row.queuedIndex} sourceIndex={row.sourceIndex} />{/each}
			</ol>
			{#if !rows.length}
				<div class="np-empty"><span class="ni"><Icon name="queue" /></span><div><b>Nothing up next</b><small>Right-click any track to add it</small></div></div>
			{/if}
			<button class="ghost" type="button" onclick={() => togglePanel(true, 'queue')}>Open queue</button>
		</aside>
	</div>
	<button class="np-close" type="button" aria-label="Close full screen" onclick={() => setFullScreen(false)}><Icon name="down" /></button>
</section>
