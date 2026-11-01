<script lang="ts">
	import { viewEnter } from '#lib/ui/viewEnter.ts';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { fixedRowMeasure } from '#lib/engine/geometry.ts';
	import { playlistById, playlistTracks, skipsDisliked, withoutDisliked } from '#lib/library/queries.ts';
	import { COVER_PX, LAYOUT } from '#lib/tuning.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import PlayButton from '#lib/ui/PlayButton.svelte';
	import PlaylistMosaic from '#lib/ui/PlaylistMosaic.svelte';
	import TrackRow from '#lib/ui/TrackRow.svelte';
	import VirtualGrid from '#lib/ui/VirtualGrid.svelte';
	import { longDuration, plural, relativeTime } from '#lib/ui/format.ts';
	import { live } from '#lib/ui/live.svelte.ts';
	import { playlistKindLabel } from '#lib/ui/playlistText.ts';

	const rowMeasure = fixedRowMeasure(LAYOUT.playlistTrackRowHeightPx);
	const id = $derived(page.params.id ?? '');
	const playlist = live(() => playlistById(id), null);
	const tracks = live(() => playlistTracks(id), []);
	const playable = $derived(skipsDisliked(playlist.value) ? withoutDisliked(tracks.value).tracks : tracks.value);
	// Keyed by position, not track id: a playlist can hold the same track more than once.
	const rows = $derived(tracks.value.map((track, index) => ({ track, index })));
	const duration = $derived(tracks.value.reduce((total, track) => total + track.duration, 0));
	const updateLine = $derived.by(() => {
		const current = playlist.value;
		if (current?.kind === 'smart') return `Updates automatically${current.updated ? ` · refreshed ${relativeTime(current.updated)}` : ''}`;
		if (current?.kind === 'genre') return `Your top ${current.genre} songs, a few from each artist · updates automatically`;
		if (current?.kind === 'artist') return 'Their most popular tracks you own · updated weekly';
		return '';
	});
</script>

{#if playlist.value}
	<section class="view" {@attach viewEnter}>
		<div class="pl-head">
			<PlaylistMosaic playlist={playlist.value} size={COVER_PX.playlistPage} />
			<div>
				<p class="eyebrow">{playlistKindLabel(playlist.value)}</p>
				<h1 class="display">{playlist.value.name}</h1>
				{#if playlist.value.kind === 'artist'}<p class="sub">
						<a href={resolve('/artist/[id]', { id: playlist.value.artistId })}>{playlist.value.name.replace(/^This is /, '')}</a>
					</p>{/if}
				{#if updateLine}<p class="sub smart-line"><Icon name="smart" /><span>{updateLine}</span></p>{/if}
				<p class="genres">{plural(tracks.value.length, 'track')} · {longDuration(duration)}</p>
				<div style:margin-top="20px"><PlayButton tracks={playable} sourceName={playlist.value.name} listKey="playlist:{id}" /></div>
			</div>
		</div>
		{#if tracks.value.length}
			<VirtualGrid items={rows} key={(row) => `${row.index}`} measure={rowMeasure} className="tracks wide">
				{#snippet item(row)}
					<TrackRow
						tracks={tracks.value}
						index={row.index}
						sourceName={playlist.value?.name ?? ''}
						listKey="playlist:{id}"
						number={row.index + 1}
						showArtist
						showAlbum
						playlist={playlist.value ?? undefined}
					/>
				{/snippet}
			</VirtualGrid>
		{:else if tracks.loaded}
			<p class="q-empty">This playlist is empty.</p>
		{/if}
	</section>
{:else if playlist.loaded}
	<p class="status-note">This playlist isn't in your library.</p>
{/if}
