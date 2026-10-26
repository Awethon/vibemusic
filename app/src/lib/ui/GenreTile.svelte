<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Playlist } from '../library/queries.ts';
	import { playlistMenu } from './actions.ts';
	import { openMenu } from './menu.svelte.ts';
	import PlaylistMosaic from './PlaylistMosaic.svelte';

	let { playlist }: { playlist: Playlist } = $props();
</script>

<a
	class="g-tile"
	href={resolve('/playlist/[id]', { id: playlist.id })}
	title={playlist.name}
	data-id={playlist.id}
	data-preview-album={playlist.mosaicAlbumIds[0]}
	oncontextmenu={(event) => openMenu(event, playlistMenu(playlist))}
>
	<PlaylistMosaic {playlist} />
</a>
