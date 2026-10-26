<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Artist } from '../library/queries.ts';
	import { artistMenu } from './actions.ts';
	import Cover from './Cover.svelte';
	import { plural } from './format.ts';
	import { openMenu } from './menu.svelte.ts';

	let { artist, layout = 'grid' }: { artist: Artist; layout?: 'grid' | 'row' | 'chip' } = $props();
	const covers = $derived(artist.coverAlbumIds.length >= 4 ? artist.coverAlbumIds.slice(0, 4) : artist.coverAlbumIds.length >= 2 ? artist.coverAlbumIds.slice(0, 2) : artist.coverAlbumIds.slice(0, 1));
</script>

<a class="artist-{layout}" href={resolve('/artist/[id]', { id: artist.id })} oncontextmenu={(event) => openMenu(event, artistMenu(artist))}>
	{#if layout === 'chip'}
		<Cover albumId={artist.newestAlbumId} size={120} round />
		<span class="name">{artist.name}<sup>{artist.albumCount}</sup></span>
	{:else if layout === 'row'}
		<span class="name">{artist.name}</span>
		<span class="meta">{plural(artist.albumCount, 'album')} · {plural(artist.trackCount, 'track')}{artist.firstYear ? ` · since ${artist.firstYear}` : ''}</span>
		<span class="stack">
			{#each artist.coverAlbumIds as albumId (albumId)}<Cover {albumId} size={96} />{/each}
		</span>
	{:else}
		<span class="covers covers-{covers.length}">
			{#each covers as albumId (albumId)}<Cover {albumId} size={covers.length > 1 ? 160 : 300} />{/each}
		</span>
		<span class="name">{artist.name}</span>
		<span class="meta">{plural(artist.albumCount, 'album')}</span>
	{/if}
</a>
