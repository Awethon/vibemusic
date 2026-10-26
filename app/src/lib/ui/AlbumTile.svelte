<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Album } from '../library/queries.ts';
	import { currentTrack } from '../player/player.svelte.ts';
	import { albumMenu } from './actions.ts';
	import Cover from './Cover.svelte';
	import { openMenu } from './menu.svelte.ts';

	let { album, subtitle }: { album: Album; subtitle?: string } = $props();
	const playing = $derived(currentTrack()?.albumId === album.id);
</script>

<a class="tile" href={resolve('/album/[id]', { id: album.id })} oncontextmenu={(event) => openMenu(event, albumMenu(album))}>
	<Cover albumId={album.id} />
	<span class="name">{#if playing}<span class="dot">●</span> {/if}{album.name}</span>
	<span class="meta">{subtitle ?? `${album.artist}${album.year ? ` · ${album.year}` : ''}`}</span>
</a>
