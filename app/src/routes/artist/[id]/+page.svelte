<script lang="ts">
	import { page } from '$app/state';
	import { albumsByArtist, artistById, artistOpeners, artistTracks } from '#lib/library/queries.ts';
	import { ARTIST_PAGE } from '#lib/tuning.ts';
	import AlbumTile from '#lib/ui/AlbumTile.svelte';
	import PlayButton from '#lib/ui/PlayButton.svelte';
	import TrackList from '#lib/ui/TrackList.svelte';
	import { plural } from '#lib/ui/format.ts';
	import { live } from '#lib/ui/live.svelte.ts';

	const id = $derived(page.params.id ?? '');
	const artist = live(() => artistById(id), null);
	const albums = live(() => albumsByArtist(id), []);
	const tracks = live(() => artistTracks(id), []);
	const openers = live(() => artistOpeners(id, ARTIST_PAGE.openerCount), []);
</script>

{#if artist.value}
	<header class="page-head">
		<p class="kicker">Artist</p>
		<h1 class="selectable">{artist.value.name}</h1>
		<p class="meta">{plural(artist.value.albumCount, 'album')} · {plural(artist.value.trackCount, 'track')}</p>
		<PlayButton tracks={tracks.value} sourceName={artist.value.name} listKey="artist:{id}" label="Play all" />
	</header>
	<section>
		<h2>Albums</h2>
		<div class="grid">
			{#each albums.value as album (album.id)}<AlbumTile {album} subtitle={album.year ? String(album.year) : ''} />{/each}
		</div>
	</section>
	<section>
		<h2>Openers</h2>
		<TrackList tracks={openers.value} sourceName={artist.value.name} listKey="top:{id}" showAlbum />
	</section>
{:else if artist.loaded}
	<p class="empty-state">Artist not found.</p>
{/if}
