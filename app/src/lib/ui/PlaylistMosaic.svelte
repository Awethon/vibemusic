<script lang="ts">
	import type { Playlist } from '../library/queries.ts';
	import Cover from './Cover.svelte';
	import { mosaicAlbumIds } from './playlistText.ts';

	let { playlist, mini = false, size = 300 }: { playlist: Playlist; mini?: boolean; size?: number } = $props();
</script>

<span class={mini ? 'j-art mini-mosaic' : 'mosaic'} class:genre={playlist.kind === 'genre'}>
	{#each mosaicAlbumIds(playlist) as albumId, index (index)}<Cover {albumId} size={mini ? 60 : Math.round(size / 2)} />{/each}
	{#if playlist.kind === 'genre' && !mini}<span class="g-label">{playlist.name}</span>{/if}
</span>
