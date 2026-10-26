<script lang="ts">
	import { viewEnter } from '#lib/ui/viewEnter.ts';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { albumsByArtist, artistById, artistPlaylist, artistTracks, playlistTracks, tracksByIds, type Artist, type Track } from '#lib/library/queries.ts';
	import { artistInfo } from '#lib/navidrome/artistInfo.ts';
	import AlbumTile from '#lib/ui/AlbumTile.svelte';
	import PlayButton from '#lib/ui/PlayButton.svelte';
	import PlaylistMosaic from '#lib/ui/PlaylistMosaic.svelte';
	import { playlistMetaLine } from '#lib/ui/playlistText.ts';
	import TrackList from '#lib/ui/TrackList.svelte';
	import { plural } from '#lib/ui/format.ts';
	import { live } from '#lib/ui/live.svelte.ts';

	const POPULAR_COUNT = 5;

	const id = $derived(page.params.id ?? '');
	const artist = live(() => artistById(id), null);
	const albums = live(() => albumsByArtist(id), []);
	const tracks = live(() => artistTracks(id), []);
	const thisIs = live(async () => {
		const playlist = await artistPlaylist(id);
		return playlist ? { playlist, tracks: await playlistTracks(playlist.id) } : null;
	}, null);

	let biography = $state('');
	let popular = $state<Track[]>([]);
	let similar = $state<Artist[]>([]);
	let expanded = $state(false);

	$effect(() => {
		const current = artist.value;
		biography = '';
		popular = [];
		similar = [];
		expanded = false;
		if (!current) return;
		let active = true;
		void artistInfo(current.id, current.name).then(async (info) => {
			const [popularTracks, similarArtists] = await Promise.all([
				tracksByIds(info.topTrackIds.slice(0, POPULAR_COUNT)),
				Promise.all(info.similarArtistIds.map((similarId) => artistById(similarId)))
			]);
			if (!active) return;
			biography = info.biography;
			popular = popularTracks.slice(0, POPULAR_COUNT);
			similar = similarArtists.filter((candidate): candidate is Artist => !!candidate);
		});
		return () => {
			active = false;
		};
	});
</script>

{#if artist.value}
	<section class="view" {@attach viewEnter}>
		<div class="vhead">
			<div class="artist-intro">
				<p class="eyebrow">Artist</p>
				<h1 class="display">{artist.value.name}</h1>
				<p class="sub">{plural(artist.value.albumCount, 'album')} · {plural(artist.value.trackCount, 'track')}{artist.value.firstYear ? ` · since ${artist.value.firstYear}` : ''}</p>
				{#if biography}
					<p class="bio" class:open={expanded}>{biography}</p>
					<button class="ghost" type="button" onclick={() => (expanded = !expanded)}>{expanded ? 'Show less' : 'Read more'}</button>
				{/if}
			</div>
			<PlayButton tracks={tracks.value} sourceName={artist.value.name} listKey="artist:{id}" label="Play all" />
		</div>
		{#if thisIs.value || popular.length}
			<div class="popular-block" class:with-playlist={!!thisIs.value}>
				<div>
					<h2 class="section-title">Popular</h2>
					{#if thisIs.value}
						<TrackList tracks={thisIs.value.tracks.slice(0, POPULAR_COUNT)} sourceName={thisIs.value.playlist.name} listKey="playlist:{thisIs.value.playlist.id}" showAlbum />
					{:else}
						<TrackList tracks={popular} sourceName={artist.value.name} listKey="top:{id}" showAlbum />
					{/if}
				</div>
				{#if thisIs.value}
					{@const playlist = thisIs.value.playlist}
					<div class="this-is-card">
						<a href={resolve('/playlist/[id]', { id: playlist.id })} data-id={playlist.id}><PlaylistMosaic {playlist} size={260} /></a>
						<a class="t" href={resolve('/playlist/[id]', { id: playlist.id })}>{playlist.name}</a>
						<span class="s">{playlistMetaLine(playlist)}</span>
						<PlayButton tracks={thisIs.value.tracks} sourceName={playlist.name} listKey="playlist:{playlist.id}" />
					</div>
				{/if}
			</div>
		{/if}
		<h2 class="section-title">Albums</h2>
		<div class="grid" id="grid">
			{#each albums.value as album (album.id)}<AlbumTile {album} />{/each}
		</div>
		{#if similar.length}
			<h2 class="section-title">Similar in your library</h2>
			<div class="artist-strip">
				{#each similar as other (other.id)}
					<a href={resolve('/artist/[id]', { id: other.id })} data-preview-album={other.newestAlbumId}>{other.name}<sup>{other.albumCount}</sup></a>
				{/each}
			</div>
		{/if}
	</section>
{:else if artist.loaded}
	<p class="status-note">This artist isn't in your library.</p>
{/if}
