<script lang="ts">
	import { viewEnter } from '#lib/ui/viewEnter.ts';
	import { resolve } from '$app/paths';
	import { albumGridMeasure } from '#lib/engine/geometry.ts';
	import { alphabetEntriesFor } from '#lib/engine/layout.svelte.ts';
	import { history } from '#lib/history.svelte.ts';
	import { library } from '#lib/library/library.svelte.ts';
	import {
		albumsByIds,
		albumWall,
		allPlaylists,
		artistById,
		artistStrip,
		playlistById,
		type AlbumSort,
		type AlbumSummary,
		type Playlist
	} from '#lib/library/queries.ts';
	import { HOME, SHELVES } from '#lib/tuning.ts';
	import AlbumTile from '#lib/ui/AlbumTile.svelte';
	import Filters from '#lib/ui/Filters.svelte';
	import { fitRows } from '#lib/ui/fitRows.ts';
	import { formFactor } from '#lib/ui/formFactor.svelte.ts';
	import JumpCard from '#lib/ui/JumpCard.svelte';
	import PlaylistTile from '#lib/ui/PlaylistTile.svelte';
	import Shelf from '#lib/ui/Shelf.svelte';
	import SortChips from '#lib/ui/SortChips.svelte';
	import VirtualGrid from '#lib/ui/VirtualGrid.svelte';
	import { alphabetBucket, decadeLabel, formatCount, plural, withoutLeadingThe } from '#lib/ui/format.ts';
	import { live } from '#lib/ui/live.svelte.ts';
	import { keepScrollNearGrid } from '#lib/ui/scrollKeep.ts';
	import { clearFilters, filterSuffix, filtering, ui } from '#lib/ui/state.svelte.ts';

	const sorts = [
		['mostPlayed', 'Most played'],
		['recentlyAdded', 'Recently added'],
		['byArtist', 'By artist'],
		['az', 'A–Z'],
		['newest', 'Newest']
	] as const satisfies readonly (readonly [AlbumSort, string])[];

	const bucketBySort: Partial<Record<AlbumSort, (album: AlbumSummary) => string>> = {
		byArtist: (album) => alphabetBucket(withoutLeadingThe(album.artist)),
		az: (album) => alphabetBucket(album.name),
		newest: (album) => decadeLabel(album.year)
	};

	const wall = live(() => albumWall(ui.albumSort, ui.filters), [], ['album']);
	const strip = live(() => artistStrip(ui.filters, HOME.artistStripCount), [], []);
	const playlists = live(allPlaylists, []);
	const jumpBackIn = live(async () => {
		const entries = await Promise.all(
			history.items.map(async (item) => {
				if (item.kind === 'album') return { key: `album:${item.id}`, album: (await albumsByIds([item.id]))[0] ?? null };
				if (item.kind === 'artist') return { key: `artist:${item.id}`, artist: await artistById(item.id) };
				return { key: `playlist:${item.id}`, playlist: await playlistById(item.id) };
			})
		);
		return entries.filter(
			(entry) => ('album' in entry && entry.album) || ('artist' in entry && entry.artist) || ('playlist' in entry && entry.playlist)
		);
	}, []);

	// Interleave playlist kinds by HOME.playlistMixPattern so one kind doesn't fill the whole shelf.
	const homePlaylists = $derived.by(() => {
		const byKind: Record<string, Playlist[]> = { own: [], smart: [], genre: [], artist: [] };
		for (const playlist of playlists.value) byKind[playlist.kind].push(playlist);
		const mixed: Playlist[] = [];
		while (mixed.length < playlists.value.length) {
			const before = mixed.length;
			for (const kind of HOME.playlistMixPattern) {
				const next = byKind[kind].shift();
				if (next) mixed.push(next);
			}
			if (mixed.length === before) break;
		}
		return mixed;
	});

	const alphabetEntries = $derived(alphabetEntriesFor(wall.value, bucketBySort[ui.albumSort] ?? null));
	const countLine = $derived(
		library.meta
			? filtering()
				? `${formatCount(wall.value.length)} of ${plural(library.meta.albums, 'album')}${filterSuffix()}`
				: plural(library.meta.albums, 'album')
			: ''
	);

	// After a sort or filter change deep in the grid, scroll back up to near the top of the grid
	// so the new results start in view. Not on first render, which keeps a restored scroll position.
	let firstRender = true;
	$effect(() => {
		void ui.albumSort;
		void ui.filters;
		if (firstRender) firstRender = false;
		else requestAnimationFrame(keepScrollNearGrid);
	});
</script>

<section class="view" {@attach viewEnter}>
	<div class="vhead">
		<div>
			<h1 class="display">Your Music</h1>
			{#if library.meta}<p class="sub">
					{plural(library.meta.albums, 'album')} · {plural(library.meta.artists, 'artist')} · {plural(library.meta.tracks, 'track')}
				</p>{/if}
		</div>
	</div>
	<div class="artist-strip" {@attach formFactor.phone && fitRows(HOME.phoneArtistRows)}>
		{#each strip.value as artist (artist.id)}
			<a href={resolve('/artist/[id]', { id: artist.id })} data-preview-album={artist.newestAlbumId}
				>{artist.name}<sup>{artist.albumCount}</sup></a
			>
		{/each}
		<a class="more" href={resolve('/artists')}>All artists →</a>
	</div>
	{#if jumpBackIn.value.length}
		<div class="sec-head first"><h2 class="section-title">Jump back in</h2></div>
		<Shelf id="jumpShelf" items={jumpBackIn.value} {...SHELVES.jumpBackIn}>
			{#snippet item(entry)}<JumpCard {...entry} />{/snippet}
		</Shelf>
	{/if}
	{#if homePlaylists.length}
		<div class="sec-head">
			<h2 class="section-title">Playlists</h2>
			<a class="see-all" href={resolve('/playlists')}>See all</a>
		</div>
		<Shelf id="plShelf" items={homePlaylists} {...SHELVES.homePlaylists}>
			{#snippet item(playlist)}<PlaylistTile {playlist} />{/snippet}
		</Shelf>
	{/if}
	<div class="sec-head"><h2 class="section-title">Albums <small>{countLine}</small></h2></div>
	<div class="toolbar">
		<SortChips options={sorts} value={ui.albumSort} onchange={(sort) => (ui.albumSort = sort)} />
		<Filters />
	</div>
	{#if wall.value.length || !wall.loaded}
		<VirtualGrid items={wall.value} key={(album) => album.id} measure={albumGridMeasure} {alphabetEntries}>
			{#snippet item(album)}<AlbumTile {album} />{/snippet}
		</VirtualGrid>
	{:else}
		<p class="empty">No albums match these filters. <button type="button" class="fclear" onclick={clearFilters}>Clear filters</button></p>
	{/if}
</section>
