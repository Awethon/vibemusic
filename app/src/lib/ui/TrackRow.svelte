<script lang="ts">
	import { isRadio, skipsDisliked, withoutDisliked, type Playlist, type Track } from '../library/queries.ts';
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
	const skipping = $derived(skipsDisliked(playlist));
	const dimmed = $derived(skipping && track.disliked);

	function play() {
		const list = skipping ? withoutDisliked(tracks, index) : { tracks, index };
		playTrackInList(list.tracks, list.index, sourceName, listKey);
	}
</script>

<div
	class="trk"
	class:playing={track.id === playerQueue().currentTrackId}
	class:disliked={dimmed}
	data-id={track.id}
	role="button"
	tabindex="-1"
	onclick={play}
	onkeydown={(event) => event.key === 'Enter' && play()}
	oncontextmenu={(event) => openMenu(event, trackMenu(tracks, index, sourceName, listKey, playlist))}
>
	<span class="n">{number}</span>
	<span class="tt"><b>{track.title}</b>{#if showArtist}<small>{track.artist}</small>{/if}</span>
	{#if showAlbum}<span class="al">{track.album}</span>{/if}
	<span class="d">{isRadio(track.id) ? 'Live' : clock(track.duration)}</span>
</div>
