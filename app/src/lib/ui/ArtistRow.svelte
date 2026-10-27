<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Artist } from '../library/queries.ts';
	import { artistMenu } from './actions.ts';
	import Cover from './Cover.svelte';
	import { plural } from './format.ts';
	import { openMenu } from './menu.svelte.ts';
	import { COVER_PX } from '../tuning.ts';

	let { artist }: { artist: Artist } = $props();
</script>

<a
	class="artist-row"
	href={resolve('/artist/[id]', { id: artist.id })}
	data-id={artist.id}
	data-preview-album={artist.newestAlbumId}
	oncontextmenu={(event) => openMenu(event, artistMenu(artist))}
>
	<div>
		<div class="name">{artist.name}</div>
		<div class="meta">{plural(artist.albumCount, 'album')} · {plural(artist.trackCount, 'track')}{artist.firstYear ? ` · since ${artist.firstYear}` : ''}</div>
	</div>
	<div class="stack">
		{#each artist.coverAlbumIds as albumId (albumId)}<Cover {albumId} size={COVER_PX.card} />{/each}
	</div>
</a>
