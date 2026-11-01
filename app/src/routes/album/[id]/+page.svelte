<script lang="ts">
	import { viewEnter } from '#lib/ui/viewEnter.ts';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { albumById, albumsByArtist, albumTracks } from '#lib/library/queries.ts';
	import { ALBUM_PAGE, COVER_PX } from '#lib/tuning.ts';
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

	// A genre link opens the home album wall with that genre as its filter.
	function showGenre(genre: string) {
		ui.filters = { genres: [genre], decades: [] };
	}
</script>

{#if album.value}
	<section class="view album-layout" {@attach viewEnter}>
		<div class="album-side">
			<Cover albumId={album.value.id} size={COVER_PX.albumPage} eager />
			<h1 class="display">{album.value.name}</h1>
			<p class="sub">
				{#if album.value.credits.length > 1}{#each album.value.credits as credit, index (credit.id)}{#if index}{index ===
							album.value.credits.length - 1
								? ' & '
								: ', '}{/if}<a href={resolve('/artist/[id]', { id: credit.id })}>{credit.name}</a>{/each}{:else}<a
						href={resolve('/artist/[id]', { id: album.value.artistId })}>{album.value.artist}</a
					>{/if}{album.value.year ? ` · ${album.value.year}` : ''}
			</p>
			<p class="genres">
				{plural(album.value.songCount, 'track')} · {longDuration(
					album.value.duration
				)}{#if album.value.genres.length}{' · '}{#each album.value.genres as genre, index (genre)}{#if index},
						{/if}<a href={resolve('/')} onclick={() => showGenre(genre)}>{genre}</a>{/each}{/if}
			</p>
			<div class="actions"><PlayButton tracks={tracks.value} sourceName={album.value.name} listKey="album:{id}" /></div>
		</div>
		<div class="album-main">
			<TrackList tracks={tracks.value} sourceName={album.value.name} listKey="album:{id}" numbering="track" discHeadings />
			{#if moreBy.value.length}
				<h2 class="section-title">More by {album.value.artist}</h2>
				<div class="grid more-by">
					{#each moreBy.value as other (other.id)}<AlbumTile album={other} />{/each}
				</div>
			{/if}
		</div>
	</section>
{:else if album.loaded}
	<p class="status-note">This album isn't in your library.</p>
{/if}
