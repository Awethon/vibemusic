<script lang="ts">
	import type { Playlist } from '../library/queries.ts';
	import { playlistCoverUrl } from '../navidrome/credentials.ts';
	import { session } from '../session.svelte.ts';
	import Cover from './Cover.svelte';
	import GenreCover from './GenreCover.svelte';
	import { mosaicAlbumIds } from './playlistText.ts';
	import { COVER_PX } from '../tuning.ts';
	import { retryCover } from './retryCover.ts';

	let { playlist, mini = false, size = COVER_PX.fallback }: { playlist: Playlist; mini?: boolean; size?: number } = $props();
</script>

<span class={mini ? 'j-art mini-mosaic' : 'mosaic'} class:image={!!playlist.image || playlist.kind === 'genre'}>
	{#if playlist.kind === 'genre'}
		<GenreCover {playlist} {mini} {size} />
	{:else if playlist.image && session.credentials}
		<img src={playlistCoverUrl(session.credentials, playlist.id, playlist.image, mini ? 120 : size * 2)} {@attach retryCover} alt="" loading="lazy" decoding="async" draggable="false" />
	{:else}
		{#each mosaicAlbumIds(playlist) as albumId, index (index)}<Cover {albumId} size={mini ? COVER_PX.mosaicMini : Math.round(size / 2)} />{/each}
	{/if}
</span>
