<script lang="ts">
	import { resolve } from '$app/paths';
	import type { AlbumSummary } from '../library/queries.ts';
	import { currentTrack } from '../player/player.svelte.ts';
	import { albumMenu } from './actions.ts';
	import Cover from './Cover.svelte';
	import { openMenu } from './menu.svelte.ts';
	import { COVER_PX } from '../tuning.ts';

	let { album, subtitle }: { album: AlbumSummary; subtitle?: string } = $props();
	const playing = $derived(currentTrack()?.albumId === album.id);
</script>

<a
	class="tile"
	class:playing
	href={resolve('/album/[id]', { id: album.id })}
	data-album={album.id}
	data-id={album.id}
	data-preview-album={album.id}
	oncontextmenu={(event) => openMenu(event, albumMenu(album))}
>
	<span class="art"><Cover albumId={album.id} size={COVER_PX.tile} /></span>
	<span class="t">{album.name}</span><span class="s">{subtitle ?? `${album.artist}${album.year ? ` · ${album.year}` : ''}`}</span>
</a>
