<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Artist } from '../library/queries.ts';
	import { artistMenu } from './actions.ts';
	import ArtistPhoto from './ArtistPhoto.svelte';
	import Cover from './Cover.svelte';
	import { plural } from './format.ts';
	import { openMenu } from './menu.svelte.ts';
	import { ARTIST_LIST, COVER_PX } from '../tuning.ts';

	let { artist }: { artist: Artist } = $props();
	const coverCount = $derived(artist.coverAlbumIds.length >= 4 ? 4 : artist.coverAlbumIds.length >= 2 ? 2 : 1);
</script>

<a
	class="tile artist-tile"
	href={resolve('/artist/[id]', { id: artist.id })}
	data-id={artist.id}
	data-preview-album={artist.newestAlbumId}
	oncontextmenu={(event) => openMenu(event, artistMenu(artist))}
>
	{#if ARTIST_LIST.photos}
		<span class="art"><ArtistPhoto artistId={artist.id} fallbackAlbumId={artist.newestAlbumId} size={COVER_PX.tile} /></span>
	{:else}
		<span class="art" class:quad={coverCount === 4} class:duo={coverCount === 2}>
			{#each artist.coverAlbumIds.slice(0, coverCount) as albumId (albumId)}<Cover
					{albumId}
					size={coverCount > 1 ? COVER_PX.tileQuarter : COVER_PX.tile}
				/>{/each}
		</span>
	{/if}
	<span class="t">{artist.name}</span><span class="s">{plural(artist.albumCount, 'album')} · {plural(artist.trackCount, 'track')}</span>
</a>
