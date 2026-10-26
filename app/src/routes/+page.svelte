<script lang="ts">
	import { resolve } from '$app/paths';
	import { history } from '#lib/history.svelte.ts';
	import { library } from '#lib/library/library.svelte.ts';
	import { albumsByIds, albumWall, allPlaylists, artistStrip, artistById, playlistById, type AlbumSort, type Playlist } from '#lib/library/queries.ts';
	import { HOME, SEARCH } from '#lib/tuning.ts';
	import AlbumTile from '#lib/ui/AlbumTile.svelte';
	import AlphabetIndex from '#lib/ui/AlphabetIndex.svelte';
	import ArtistTile from '#lib/ui/ArtistTile.svelte';
	import Chips from '#lib/ui/Chips.svelte';
	import Filters from '#lib/ui/Filters.svelte';
	import JumpCard from '#lib/ui/JumpCard.svelte';
	import PlaylistCard from '#lib/ui/PlaylistCard.svelte';
	import { alphabetBucket, decadeLabel, plural } from '#lib/ui/format.ts';
	import { live } from '#lib/ui/live.svelte.ts';
	import { filtering, ui } from '#lib/ui/state.svelte.ts';

	const sorts: { value: AlbumSort; label: string }[] = [
		{ value: 'mostPlayed', label: 'Most played' },
		{ value: 'recentlyAdded', label: 'Recently added' },
		{ value: 'byArtist', label: 'By artist' },
		{ value: 'az', label: 'A–Z' },
		{ value: 'newest', label: 'Newest' }
	];

	const wall = live(() => albumWall(ui.albumSort, ui.filters), []);
	const strip = live(() => artistStrip(ui.filters, HOME.artistStripCount), []);
	const playlists = live(allPlaylists, []);
	const jumpBackIn = live(async () => {
		const items = history.items.slice(0, SEARCH.recentCount * 2);
		return Promise.all(
			items.map(async (item) => {
				if (item.kind === 'album') return { item, album: (await albumsByIds([item.id]))[0] ?? null };
				if (item.kind === 'artist') return { item, artist: await artistById(item.id) };
				return { item, playlist: await playlistById(item.id) };
			})
		);
	}, []);

	const homePlaylists = $derived.by(() => {
		const byKind = { own: [] as Playlist[], smart: [] as Playlist[], genre: [] as Playlist[] };
		for (const playlist of playlists.value) byKind[playlist.kind].push(playlist);
		const mixed: Playlist[] = [];
		const pattern = HOME.playlistMixPattern as readonly (keyof typeof byKind)[];
		while (mixed.length < playlists.value.length) {
			const before = mixed.length;
			for (const kind of pattern) {
				const next = byKind[kind].shift();
				if (next) mixed.push(next);
			}
			if (mixed.length === before) break;
		}
		return mixed;
	});

	const buckets = $derived.by(() => {
		const label = ui.albumSort === 'byArtist' ? (index: number) => alphabetBucket(wall.value[index].artist) : ui.albumSort === 'az' ? (index: number) => alphabetBucket(wall.value[index].name) : ui.albumSort === 'newest' ? (index: number) => decadeLabel(wall.value[index].year) : null;
		if (!label) return [];
		const result: { label: string; index: number }[] = [];
		wall.value.forEach((_, index) => {
			const bucket = label(index);
			if (result.at(-1)?.label !== bucket) result.push({ label: bucket, index });
		});
		return result;
	});
</script>

<header class="page-head">
	<h1>Your Music</h1>
	{#if library.meta}<p class="meta">{plural(library.meta.albums, 'album')} · {plural(library.meta.artists, 'artist')} · {plural(library.meta.tracks, 'track')}</p>{/if}
</header>

<section class="artist-strip">
	{#each strip.value as artist (artist.id)}<ArtistTile {artist} layout="chip" />{/each}
	<a class="more" href={resolve('/artists')}>All artists →</a>
</section>

{#if jumpBackIn.value.length}
	<section>
		<h2>Jump back in</h2>
		<div class="shelf jump">
			{#each jumpBackIn.value as entry (entry.item.kind + entry.item.id)}<JumpCard {...entry} />{/each}
		</div>
	</section>
{/if}

{#if homePlaylists.length}
	<section>
		<h2>Playlists <a class="more" href={resolve('/playlists')}>See all</a></h2>
		<div class="shelf playlists-shelf">
			{#each homePlaylists as playlist (playlist.id)}<PlaylistCard {playlist} />{/each}
		</div>
	</section>
{/if}

<section>
	<div class="toolbar">
		<h2>Albums</h2>
		<Chips options={sorts} value={ui.albumSort} onchange={(sort) => (ui.albumSort = sort)} />
		<Filters />
		{#if filtering() && library.meta}<span class="meta">{wall.value.length} of {plural(library.meta.albums, 'album')}</span>{/if}
	</div>
	<AlphabetIndex {buckets} target="wall" />
	<div class="grid" data-index-target="wall">
		{#each wall.value as album (album.id)}<AlbumTile {album} />{/each}
	</div>
</section>
