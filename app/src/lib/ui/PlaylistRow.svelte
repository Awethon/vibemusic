<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Playlist } from '../library/queries.ts';
	import { playlistMenu } from './actions.ts';
	import { openMenu } from './menu.svelte.ts';
	import PlaylistMosaic from './PlaylistMosaic.svelte';
	import { playlistMetaLine } from './playlistText.ts';
	import SmartIcon from './SmartIcon.svelte';

	let { playlist }: { playlist: Playlist } = $props();
</script>

<a
	class="pl-row"
	href={resolve('/playlist/[id]', { id: playlist.id })}
	data-id={playlist.id}
	data-preview-album={playlist.mosaicAlbumIds[0]}
	oncontextmenu={(event) => openMenu(event, playlistMenu(playlist))}
>
	<PlaylistMosaic {playlist} mini />
	<span class="pr-text"
		><b
			>{#if playlist.kind === 'smart'}<SmartIcon />{/if}{playlist.name}</b
		><small>{playlistMetaLine(playlist)}</small></span
	>
</a>
