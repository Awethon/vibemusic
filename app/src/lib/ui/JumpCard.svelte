<script lang="ts">
	import { resolve } from '$app/paths';
	import type { HistoryItem } from '../history.svelte.ts';
	import type { Album, Artist, Playlist } from '../library/queries.ts';
	import Cover from './Cover.svelte';
	import Mosaic from './Mosaic.svelte';
	import { plural } from './format.ts';
	import { playlistKindLabel } from './PlaylistCard.svelte';

	let { album, artist, playlist }: { item: HistoryItem; album?: Album | null; artist?: Artist | null; playlist?: Playlist | null } = $props();
</script>

{#if album}
	<a class="jump" href={resolve('/album/[id]', { id: album.id })}><Cover albumId={album.id} size={120} /><span class="name">{album.name}</span><span class="meta">Album · {album.artist}</span></a>
{:else if artist}
	<a class="jump" href={resolve('/artist/[id]', { id: artist.id })}><Cover albumId={artist.newestAlbumId} size={120} round /><span class="name">{artist.name}</span><span class="meta">Artist · {plural(artist.albumCount, 'album')}</span></a>
{:else if playlist}
	<a class="jump" href={resolve('/playlist/[id]', { id: playlist.id })}><Mosaic albumIds={playlist.mosaicAlbumIds} size={120} /><span class="name">{playlist.name}</span><span class="meta">{playlistKindLabel[playlist.kind]}</span></a>
{/if}
