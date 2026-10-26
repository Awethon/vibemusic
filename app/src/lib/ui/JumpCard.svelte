<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Album, Artist, Playlist } from '../library/queries.ts';
	import { albumMenu, artistMenu, playlistMenu } from './actions.ts';
	import Cover from './Cover.svelte';
	import { plural } from './format.ts';
	import { openMenu } from './menu.svelte.ts';
	import PlaylistMosaic from './PlaylistMosaic.svelte';
	import { playlistKindLabel } from './playlistText.ts';
	import SmartIcon from './SmartIcon.svelte';

	let { album, artist, playlist }: { album?: Album | null; artist?: Artist | null; playlist?: Playlist | null } = $props();
</script>

{#if album}
	<a class="jump" href={resolve('/album/[id]', { id: album.id })} data-id="album:{album.id}" data-preview-album={album.id} oncontextmenu={(event) => openMenu(event, albumMenu(album))}>
		<span class="j-art"><Cover albumId={album.id} size={120} /></span>
		<span class="j-text"><b>{album.name}</b><small>Album · {album.artist}</small></span>
	</a>
{:else if artist}
	<a class="jump" href={resolve('/artist/[id]', { id: artist.id })} data-id="artist:{artist.id}" data-preview-album={artist.newestAlbumId} oncontextmenu={(event) => openMenu(event, artistMenu(artist))}>
		<span class="j-art round"><Cover albumId={artist.newestAlbumId} size={120} /></span>
		<span class="j-text"><b>{artist.name}</b><small>Artist · {plural(artist.albumCount, 'album')}</small></span>
	</a>
{:else if playlist}
	<a class="jump" href={resolve('/playlist/[id]', { id: playlist.id })} data-id="playlist:{playlist.id}" data-preview-album={playlist.mosaicAlbumIds[0]} oncontextmenu={(event) => openMenu(event, playlistMenu(playlist))}>
		<PlaylistMosaic {playlist} mini />
		<span class="j-text"><b>{#if playlist.kind === 'smart'}<SmartIcon />{/if}{playlist.name}</b><small>{playlistKindLabel(playlist)}</small></span>
	</a>
{/if}
