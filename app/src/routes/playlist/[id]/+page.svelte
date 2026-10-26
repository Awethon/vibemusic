<script lang="ts">
	import { page } from '$app/state';
	import { playlistById, playlistTracks } from '#lib/library/queries.ts';
	import Mosaic from '#lib/ui/Mosaic.svelte';
	import PlayButton from '#lib/ui/PlayButton.svelte';
	import { playlistKindLabel } from '#lib/ui/PlaylistCard.svelte';
	import TrackList from '#lib/ui/TrackList.svelte';
	import { longDuration, plural, relativeTime } from '#lib/ui/format.ts';
	import { live } from '#lib/ui/live.svelte.ts';

	const id = $derived(page.params.id ?? '');
	const playlist = live(() => playlistById(id), null);
	const tracks = live(() => playlistTracks(id), []);
	const duration = $derived(tracks.value.reduce((total, track) => total + track.duration, 0));
</script>

{#if playlist.value}
	<header class="page-head playlist-head">
		<Mosaic albumIds={playlist.value.mosaicAlbumIds} size={240} />
		<div>
			<p class="kicker">{playlistKindLabel[playlist.value.kind]}</p>
			<h1 class="selectable">{playlist.value.name}</h1>
			{#if playlist.value.kind === 'smart'}<p class="meta">Updates automatically{playlist.value.updated ? ` · refreshed ${relativeTime(playlist.value.updated)}` : ''}</p>{/if}
			{#if playlist.value.kind === 'genre'}<p class="meta">Built from your {playlist.value.genre} albums · updates automatically</p>{/if}
			<p class="meta">{plural(tracks.value.length, 'track')} · {longDuration(duration)}</p>
			<PlayButton tracks={tracks.value} sourceName={playlist.value.name} listKey="playlist:{id}" />
		</div>
	</header>
	<TrackList tracks={tracks.value} sourceName={playlist.value.name} listKey="playlist:{id}" showAlbum playlist={playlist.value} />
{:else if playlist.loaded}
	<p class="empty-state">Playlist not found.</p>
{/if}
