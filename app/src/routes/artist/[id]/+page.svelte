<script lang="ts">
	import { viewEnter } from '#lib/ui/viewEnter.ts';
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
	<section class="view" {@attach viewEnter}>
		<div class="vhead">
			<div>
				<p class="eyebrow">Artist</p>
				<h1 class="display">{artist.value.name}</h1>
				<p class="sub">{plural(artist.value.albumCount, 'album')} · {plural(artist.value.trackCount, 'track')}</p>
			</div>
			<PlayButton tracks={tracks.value} sourceName={artist.value.name} listKey="artist:{id}" label="Play all" />
		</div>
		<div class="grid" id="grid">
			{#each albums.value as album (album.id)}<AlbumTile {album} />{/each}
		</div>
		<h2 class="section-title">Openers</h2>
		<TrackList tracks={openers.value} sourceName={artist.value.name} listKey="top:{id}" showAlbum />
	</section>
{:else if artist.loaded}
	<p class="status-note">This artist isn't in your library.</p>
{/if}
