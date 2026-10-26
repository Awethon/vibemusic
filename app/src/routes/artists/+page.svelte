<script lang="ts">
	import { artistList, type ArtistSort } from '#lib/library/queries.ts';
	import AlphabetIndex from '#lib/ui/AlphabetIndex.svelte';
	import ArtistTile from '#lib/ui/ArtistTile.svelte';
	import Chips from '#lib/ui/Chips.svelte';
	import Filters from '#lib/ui/Filters.svelte';
	import { alphabetBucket, plural } from '#lib/ui/format.ts';
	import { live } from '#lib/ui/live.svelte.ts';
	import { setArtistView, ui } from '#lib/ui/state.svelte.ts';

	const sorts: { value: ArtistSort; label: string }[] = [
		{ value: 'mostAlbums', label: 'Most albums' },
		{ value: 'az', label: 'A–Z' }
	];

	const artists = live(() => artistList(ui.artistSort, ui.filters), []);
	const buckets = $derived.by(() => {
		if (ui.artistSort !== 'az') return [];
		const result: { label: string; index: number }[] = [];
		artists.value.forEach((artist, index) => {
			const bucket = alphabetBucket(artist.name);
			if (result.at(-1)?.label !== bucket) result.push({ label: bucket, index });
		});
		return result;
	});
</script>

<header class="page-head">
	<h1>Artists</h1>
	<p class="meta">{plural(artists.value.length, 'artist')}</p>
</header>
<div class="toolbar">
	<Chips options={sorts} value={ui.artistSort} onchange={(sort) => (ui.artistSort = sort)} />
	<Filters />
	<Chips options={[{ value: 'list', label: 'List' }, { value: 'grid', label: 'Grid' }] as const} value={ui.artistView} onchange={setArtistView} />
</div>
<AlphabetIndex {buckets} target="artists" />
<div class={ui.artistView === 'grid' ? 'grid' : 'rows'} data-index-target="artists">
	{#each artists.value as artist (artist.id)}<ArtistTile {artist} layout={ui.artistView === 'grid' ? 'grid' : 'row'} />{/each}
</div>
