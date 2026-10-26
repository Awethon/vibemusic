<script lang="ts">
	import { currentTrack, player, toggleLike } from '../player/player.svelte.ts';
	import { QUEUE, LYRICS } from '../tuning.ts';
	import * as queue from '../player/queue.ts';
	import Cover from './Cover.svelte';
	import { countLabel } from './format.ts';
	import LyricsView from './LyricsView.svelte';
	import UpNext from './UpNext.svelte';
	import { ui } from './state.svelte.ts';

	const track = $derived(currentTrack());
	const count = $derived(queue.upNextCount(player.queue));
</script>

<aside class="panel" class:open={ui.panelOpen}>
	{#if track}
		<p class="kicker">Playing from {player.queue.sourceName || 'queue'}</p>
		<div class="panel-now selectable">
			<Cover albumId={track.albumId} size={160} />
			<div>
				<p class="title">{track.title}</p>
				<p class="meta">{track.artist} · {track.album}</p>
			</div>
			<button class="icon-button" class:liked={track.starred} onclick={() => toggleLike(track)}>{track.starred ? '♥' : '♡'}</button>
		</div>
	{/if}
	<div class="tabs">
		<button class:active={ui.panelTab === 'queue'} onclick={() => (ui.panelTab = 'queue')}>Up next <small>{countLabel(count, QUEUE.countDisplayCap)}</small></button>
		<button class:active={ui.panelTab === 'lyrics'} onclick={() => (ui.panelTab = 'lyrics')}>Lyrics</button>
	</div>
	<div class="panel-body">
		{#if ui.panelTab === 'queue'}<UpNext />{:else}<LyricsView focusRatio={LYRICS.focusLineRatio.panel} />{/if}
	</div>
</aside>
