<script lang="ts">
	import type { Playlist, Track } from '../library/queries.ts';
	import { playTrackInList, playerQueue } from '../player/player.svelte.ts';
	import { trackMenu } from './actions.ts';
	import { clock } from './format.ts';
	import { openMenu } from './menu.svelte.ts';

	let {
		tracks,
		index,
		sourceName,
		listKey,
		number,
		showArtist,
		showAlbum,
		playlist
	}: { tracks: Track[]; index: number; sourceName: string; listKey: string; number: number | string; showArtist: boolean; showAlbum: boolean; playlist?: Playlist } = $props();

	const track = $derived(tracks[index]);
</script>

<div
	class="trk"
	class:playing={track.id === playerQueue().currentTrackId}
	data-id={track.id}
	role="button"
	tabindex="-1"
	onclick={() => playTrackInList(tracks, index, sourceName, listKey)}
	onkeydown={(event) => event.key === 'Enter' && playTrackInList(tracks, index, sourceName, listKey)}
	oncontextmenu={(event) => openMenu(event, trackMenu(tracks, index, sourceName, listKey, playlist))}
>
	<span class="n">{number}</span>
	<span class="tt"><b>{track.title}</b>{#if showArtist}<small>{track.artist}</small>{/if}</span>
	{#if showAlbum}<span class="al">{track.album}</span>{/if}
	<span class="d">{clock(track.duration)}</span>
</div>
