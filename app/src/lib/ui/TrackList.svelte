<script lang="ts">
	import type { Playlist, Track } from '../library/queries.ts';
	import { player, playTrackInList } from '../player/player.svelte.ts';
	import { trackMenu } from './actions.ts';
	import { clock } from './format.ts';
	import { openMenu } from './menu.svelte.ts';

	let {
		tracks,
		sourceName,
		listKey,
		numbering = 'index',
		showAlbum = false,
		discHeadings = false,
		playlist
	}: { tracks: Track[]; sourceName: string; listKey: string; numbering?: 'track' | 'index'; showAlbum?: boolean; discHeadings?: boolean; playlist?: Playlist } = $props();

	const multiDisc = $derived(discHeadings && new Set(tracks.map((track) => track.discNo)).size > 1);
</script>

<div class="tracks">
	{#each tracks as track, index (index)}
		{#if multiDisc && (index === 0 || tracks[index - 1].discNo !== track.discNo)}
			<div class="disc">Disc {track.discNo}</div>
		{/if}
		<div
			class="track"
			class:current={track.id === player.queue.currentTrackId}
			role="button"
			tabindex="0"
			onkeydown={(event) => event.key === 'Enter' && playTrackInList(tracks, index, sourceName, listKey)}
			onclick={() => playTrackInList(tracks, index, sourceName, listKey)}
			oncontextmenu={(event) => openMenu(event, trackMenu(tracks, index, sourceName, listKey, playlist))}
		>
			<span class="number">{track.id === player.queue.currentTrackId && player.playing ? '▶' : numbering === 'track' ? track.trackNo || '' : index + 1}</span>
			<span class="title selectable">{track.title}</span>
			<span class="artist selectable">{track.artist}</span>
			{#if showAlbum}<span class="album selectable">{track.album}</span>{/if}
			<span class="duration">{clock(track.duration)}</span>
		</div>
	{/each}
</div>
