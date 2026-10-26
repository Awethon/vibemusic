<script lang="ts">
	import { viewEnter } from '#lib/ui/viewEnter.ts';
	import { albumGridMeasure, fixedRowMeasure } from '#lib/engine/geometry.ts';
	import { alphabetEntriesFor } from '#lib/engine/layout.svelte.ts';
	import { library } from '#lib/library/library.svelte.ts';
	import { artistList, type ArtistSort } from '#lib/library/queries.ts';
	import { LAYOUT } from '#lib/tuning.ts';
	import ArtistRow from '#lib/ui/ArtistRow.svelte';
	import ArtistTile from '#lib/ui/ArtistTile.svelte';
	import Filters from '#lib/ui/Filters.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import SortChips from '#lib/ui/SortChips.svelte';
	import VirtualGrid from '#lib/ui/VirtualGrid.svelte';
	import { alphabetBucket, formatCount, plural, withoutLeadingThe } from '#lib/ui/format.ts';
	import { live } from '#lib/ui/live.svelte.ts';
	import { keepScrollNearGrid } from '#lib/ui/scrollKeep.ts';
	import { clearFilters, filterSuffix, filtering, setArtistView, ui } from '#lib/ui/state.svelte.ts';

	const sorts = [
		['az', 'A–Z'],
		['mostAlbums', 'Most albums']
	] as const satisfies readonly (readonly [ArtistSort, string])[];

	const rowMeasure = fixedRowMeasure(LAYOUT.artistRowHeightPx);
	const artists = live(() => artistList(ui.artistSort, ui.filters), []);
	const alphabetEntries = $derived(ui.artistSort === 'az' ? alphabetEntriesFor(artists.value, (artist) => alphabetBucket(withoutLeadingThe(artist.name))) : null);
	const total = $derived(library.meta?.artists ?? 0);
	const countLine = $derived(filtering() ? `${formatCount(artists.value.length)} of ${plural(total, 'artist')}${filterSuffix()}` : plural(total, 'artist'));

	let firstRender = true;
	$effect(() => {
		void ui.artistSort;
		void ui.filters;
		void ui.artistView;
		if (firstRender) firstRender = false;
		else requestAnimationFrame(keepScrollNearGrid);
	});
</script>

<section class="view" {@attach viewEnter}>
	<div class="vhead"><div><h1 class="display">Artists</h1><p class="sub">{countLine}</p></div></div>
	<div class="toolbar">
		<SortChips options={sorts} value={ui.artistSort} onchange={(sort) => (ui.artistSort = sort)} />
		<div class="tb-right">
			<Filters />
			<div class="seg-toggle" role="group" aria-label="View">
				<button type="button" class:on={ui.artistView === 'list'} aria-label="List view" title="List" onclick={() => setArtistView('list')}><Icon name="list" /></button>
				<button type="button" class:on={ui.artistView === 'grid'} aria-label="Grid view" title="Grid" onclick={() => setArtistView('grid')}><Icon name="grid" /></button>
			</div>
		</div>
	</div>
	{#if artists.value.length || !artists.loaded}
		{#if ui.artistView === 'grid'}
			<VirtualGrid items={artists.value} key={(artist) => artist.id} measure={albumGridMeasure} {alphabetEntries} className="artist-grid">
				{#snippet item(artist)}<ArtistTile {artist} />{/snippet}
			</VirtualGrid>
		{:else}
			<VirtualGrid items={artists.value} key={(artist) => artist.id} measure={rowMeasure} {alphabetEntries} className="artist-list">
				{#snippet item(artist)}<ArtistRow {artist} />{/snippet}
			</VirtualGrid>
		{/if}
	{:else}
		<p class="empty">No artists match these filters. <button type="button" class="fclear" onclick={clearFilters}>Clear filters</button></p>
	{/if}
</section>
