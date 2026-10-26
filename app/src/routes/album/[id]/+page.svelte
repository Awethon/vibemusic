<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { albumById, albumsByArtist, albumTracks } from '#lib/library/queries.ts';
	import { ALBUM_PAGE } from '#lib/tuning.ts';
	import AlbumTile from '#lib/ui/AlbumTile.svelte';
	import Cover from '#lib/ui/Cover.svelte';
	import PlayButton from '#lib/ui/PlayButton.svelte';
	import TrackList from '#lib/ui/TrackList.svelte';
	import { longDuration, plural } from '#lib/ui/format.ts';
	import { live } from '#lib/ui/live.svelte.ts';
	import { ui } from '#lib/ui/state.svelte.ts';

	const id = $derived(page.params.id ?? '');
	const album = live(() => albumById(id), null);
	const tracks = live(() => albumTracks(id), []);
	const moreBy = live(async () => {
		const current = await albumById(id);
		return current ? (await albumsByArtist(current.artistId)).filter((other) => other.id !== id).slice(0, ALBUM_PAGE.moreByCount) : [];
	}, []);

	function filterByGenre(genre: string) {
		ui.filters = { genres: [genre], decades: [] };
		void goto(resolve('/'));
	}
</script>

{#if album.value}
	<div class="album-page">
		<aside class="album-side selectable">
			<Cover albumId={album.value.id} size={600} />
			<h1>{album.value.name}</h1>
			<p><a href={resolve('/artist/[id]', { id: album.value.artistId })}>{album.value.artist}</a>{album.value.year ? ` · ${album.value.year}` : ''}</p>
			<p class="meta">
				{plural(album.value.songCount, 'track')} · {longDuration(album.value.duration)}
				{#each album.value.genres as genre (genre)} · <button class="link" onclick={() => filterByGenre(genre)}>{genre}</button>{/each}
			</p>
			<PlayButton tracks={tracks.value} sourceName={album.value.name} listKey="album:{id}" />
		</aside>
		<div class="album-main">
			<TrackList tracks={tracks.value} sourceName={album.value.name} listKey="album:{id}" numbering="track" discHeadings />
			{#if moreBy.value.length}
				<section>
					<h2>More by {album.value.artist}</h2>
					<div class="grid">
						{#each moreBy.value as other (other.id)}<AlbumTile album={other} subtitle={other.year ? String(other.year) : ''} />{/each}
					</div>
				</section>
			{/if}
		</div>
	</div>
{:else if album.loaded}
	<p class="empty-state">Album not found.</p>
{/if}
