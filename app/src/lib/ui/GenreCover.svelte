<script lang="ts">
	import type { Playlist } from '../library/queries.ts';
	import { albumPalette } from '../library/palette.ts';
	import { coverUrl } from '../navidrome/credentials.ts';
	import { session } from '../session.svelte.ts';
	import { genreTheme } from './genreTheme.ts';
	import { playlistMetaLine } from './playlistText.ts';

	const WALL_TILES = 16;

	let { playlist, mini = false, size = 300 }: { playlist: Playlist; mini?: boolean; size?: number } = $props();

	let colors = $state<string[]>([]);
	const albumIds = $derived(playlist.mosaicAlbumIds);
	const tiles = $derived(albumIds.length ? Array.from({ length: WALL_TILES }, (_, index) => albumIds[(index + Math.floor(index / 4)) % albumIds.length]) : []);
	const theme = $derived(genreTheme(colors));
	const tileSize = $derived(mini ? 60 : Math.round(size * 0.8));
	const nameSize = $derived(Math.min(78, 520 / (Math.max(1, playlist.name.length) * 0.74)));

	$effect(() => {
		const id = albumIds[0];
		colors = [];
		if (!id) return;
		let current = true;
		void albumPalette(id)
			.then((palette) => {
				if (current) colors = palette;
			})
			.catch(() => {});
		return () => {
			current = false;
		};
	});
</script>

<span class="genre-cover" class:mini style="--gc-accent: {theme.accent}; --gc-deep: {theme.deep}; --gc-deep-alpha: {theme.deepAlpha}">
	<span class="gc-canvas">
		<span class="gc-wall">
			{#if session.credentials}
				{#each tiles as albumId, index (index)}<img src={coverUrl(session.credentials, albumId, tileSize)} alt="" loading="lazy" decoding="async" draggable="false" />{/each}
			{/if}
		</span>
		<span class="gc-shade"></span>
		{#if !mini}
			<span class="gc-eyebrow">Genre</span>
			<span class="gc-name" style="font-size: calc(var(--gc-u) * {nameSize.toFixed(1)})">{playlist.name}</span>
			<span class="gc-facts">{playlistMetaLine(playlist)}</span>
			<span class="gc-mark">v<span>m</span></span>
		{/if}
	</span>
</span>
