<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Playlist } from '../library/queries.ts';
	import { playlistMenu } from './actions.ts';
	import { plural, relativeTime } from './format.ts';
	import { openMenu } from './menu.svelte.ts';
	import Mosaic from './Mosaic.svelte';
	import Cover from './Cover.svelte';

	let { playlist, layout = 'card' }: { playlist: Playlist; layout?: 'card' | 'row' | 'genre' } = $props();
</script>

<a class="playlist-{layout}" href={resolve('/playlist/[id]', { id: playlist.id })} oncontextmenu={(event) => openMenu(event, playlistMenu(playlist))}>
	{#if layout === 'genre'}
		<Cover albumId={playlist.mosaicAlbumIds[0]} />
	{:else}
		<Mosaic albumIds={playlist.mosaicAlbumIds} />
	{/if}
	<span class="name">{playlist.name}</span>
	<span class="meta">{playlistMeta(playlist)}</span>
</a>

<script lang="ts" module>
	export const playlistKindLabel = { own: 'Playlist', smart: 'Smart playlist', genre: 'Genre playlist' } as const;

	export function playlistMeta(playlist: Playlist): string {
		if (playlist.kind === 'genre') return `${plural(playlist.albumCount, 'album')} · ${plural(playlist.songCount, 'track')}`;
		if (playlist.kind === 'smart') return `${plural(playlist.songCount, 'track')}${playlist.updated ? ` · updated ${relativeTime(playlist.updated)}` : ''}`;
		return plural(playlist.songCount, 'track');
	}
</script>
