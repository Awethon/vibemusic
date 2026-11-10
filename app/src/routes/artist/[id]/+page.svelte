<script lang="ts">
	import { viewEnter } from '#lib/ui/viewEnter.ts';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		albumsByArtist,
		artistById,
		artistPlaylist,
		playlistTracks,
		tracksByIds,
		withoutDisliked,
		type Artist,
		type Track
	} from '#lib/library/queries.ts';
	import { artistInfo, type ArtistInfo } from '#lib/navidrome/artistInfo.ts';
	import AlbumTile from '#lib/ui/AlbumTile.svelte';
	import PlayButton from '#lib/ui/PlayButton.svelte';
	import PlaylistMosaic from '#lib/ui/PlaylistMosaic.svelte';
	import { playlistMetaLine } from '#lib/ui/playlistText.ts';
	import TrackList from '#lib/ui/TrackList.svelte';
	import { plural } from '#lib/ui/format.ts';
	import { live } from '#lib/ui/live.svelte.ts';
	import { ARTIST_PAGE, COVER_PX } from '#lib/tuning.ts';

	const id = $derived(page.params.id ?? '');
	const artist = live(() => artistById(id), null);
	const albums = live(() => albumsByArtist(id), []);
	const thisIs = live(async () => {
		const playlist = await artistPlaylist(id);
		return playlist ? { playlist, tracks: await playlistTracks(playlist.id) } : null;
	}, null);

	// What Navidrome knows about the artist from outside: biography, top songs, similar artists.
	// It follows the artist's id and name, not the artist row, which is read again after every
	// like and play: that used to empty this part of the page and close an opened biography.
	let info = $state<ArtistInfo | null>(null);
	let expanded = $state(false);
	const shownId = $derived(artist.value?.id ?? '');
	const shownName = $derived(artist.value?.name ?? '');

	$effect(() => {
		info = null;
		expanded = false;
		if (!shownId) return;
		let active = true;
		void artistInfo(shownId, shownName).then((found) => {
			if (active) info = found;
		});
		return () => {
			active = false;
		};
	});

	const biography = $derived(info?.biography ?? '');
	const popular = live(async () => (info ? (await tracksByIds(info.topTrackIds)).slice(0, ARTIST_PAGE.popularCount) : []), [], ['track']);
	const similar = live(
		async () => (await Promise.all((info?.similarArtistIds ?? []).map((similarId) => artistById(similarId)))).filter((found) => !!found),
		[],
		[]
	);
</script>

{#if artist.value}
	<section class="view" {@attach viewEnter}>
		<div class="vhead">
			<div class="artist-intro">
				<p class="eyebrow">Artist</p>
				<h1 class="display">{artist.value.name}</h1>
				<p class="sub">
					{plural(artist.value.albumCount, 'album')} · {plural(artist.value.trackCount, 'track')}{artist.value.firstYear
						? ` · since ${artist.value.firstYear}`
						: ''}
				</p>
				{#if biography}
					<p class="bio" class:open={expanded}>{biography}</p>
					<button class="ghost" type="button" onclick={() => (expanded = !expanded)}>{expanded ? 'Show less' : 'Read more'}</button>
				{/if}
			</div>
		</div>
		{#if thisIs.value || popular.value.length}
			<div class="popular-block" class:with-playlist={!!thisIs.value}>
				<div>
					<h2 class="section-title">Popular</h2>
					{#if thisIs.value}
						<TrackList
							tracks={thisIs.value.tracks.slice(0, ARTIST_PAGE.popularCount)}
							sourceName={thisIs.value.playlist.name}
							listKey="playlist:{thisIs.value.playlist.id}"
							playlist={thisIs.value.playlist}
							showAlbum
						/>
					{:else}
						<TrackList tracks={popular.value} sourceName={artist.value.name} listKey="top:{id}" showAlbum />
					{/if}
				</div>
				{#if thisIs.value}
					{@const playlist = thisIs.value.playlist}
					<div class="this-is-card">
						<a href={resolve('/playlist/[id]', { id: playlist.id })} data-id={playlist.id}
							><PlaylistMosaic {playlist} size={COVER_PX.artistPlaylist} /></a
						>
						<a class="t" href={resolve('/playlist/[id]', { id: playlist.id })}>{playlist.name}</a>
						<span class="s">{playlistMetaLine(playlist)}</span>
						<PlayButton tracks={withoutDisliked(thisIs.value.tracks).tracks} sourceName={playlist.name} listKey="playlist:{playlist.id}" />
					</div>
				{/if}
			</div>
		{/if}
		<h2 class="section-title">Albums</h2>
		<div class="grid" id="grid">
			{#each albums.value as album (album.id)}<AlbumTile {album} />{/each}
		</div>
		{#if similar.value.length}
			<h2 class="section-title">Similar in your library</h2>
			<div class="artist-strip">
				{#each similar.value as other (other.id)}
					<a href={resolve('/artist/[id]', { id: other.id })} data-preview-album={other.newestAlbumId}
						>{other.name}<sup>{other.albumCount}</sup></a
					>
				{/each}
			</div>
		{/if}
	</section>
{:else if artist.loaded}
	<p class="status-note">This artist isn't in your library.</p>
{/if}
