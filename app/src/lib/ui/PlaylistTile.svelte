<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Playlist } from '../library/queries.ts';
	import { playlistMenu } from './actions.ts';
	import { openMenu } from './menu.svelte.ts';
	import PlaylistMosaic from './PlaylistMosaic.svelte';
	import { playlistKindLabel, playlistMetaLine } from './playlistText.ts';
	import SmartIcon from './SmartIcon.svelte';

	let { playlist, variant = 'tile' }: { playlist: Playlist; variant?: 'tile' | 'card' } = $props();
</script>

<a
	class={variant === 'card' ? 'pl-card' : 'pl-tile'}
	href={resolve('/playlist/[id]', { id: playlist.id })}
	data-id={playlist.id}
	data-preview-album={playlist.mosaicAlbumIds[0]}
	oncontextmenu={(event) => openMenu(event, playlistMenu(playlist))}
>
	<PlaylistMosaic {playlist} />
	<span class="t">{#if playlist.kind === 'smart'}<SmartIcon />{/if}{playlist.name}</span>
	<span class="s">{variant === 'card' ? playlistMetaLine(playlist) : playlistKindLabel(playlist)}</span>
</a>
