<script lang="ts">
	import type { Playlist } from '../library/queries.ts';
	import { albumPalette } from '../library/palette.ts';
	import { coverUrl } from '../navidrome/credentials.ts';
	import { session } from '../session.svelte.ts';
	import { genreTheme } from './genreTheme.ts';
	import { playlistMetaLine } from './playlistText.ts';
	import { COVER_PX, GENRE_COVER } from '../tuning.ts';
	import { retryCover } from './retryCover.ts';

	let { playlist, mini = false, size = COVER_PX.fallback }: { playlist: Playlist; mini?: boolean; size?: number } = $props();

	let colors = $state<string[]>([]);
	const albumIds = $derived(playlist.mosaicAlbumIds);
	const tiles = $derived(albumIds.length ? Array.from({ length: GENRE_COVER.wallTiles }, (_, index) => albumIds[(index + Math.floor(index / GENRE_COVER.wallRowLength)) % albumIds.length]) : []);
	const theme = $derived(genreTheme(colors));
	const tileSize = $derived(mini ? GENRE_COVER.miniTilePx : Math.round(size * GENRE_COVER.tileToCoverRatio));
	const nameSize = $derived(Math.min(GENRE_COVER.maxNamePx, GENRE_COVER.nameWidthPx / (Math.max(1, playlist.name.length) * GENRE_COVER.letterWidthRatio)));

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
				{#each tiles as albumId, index (index)}<img src={coverUrl(session.credentials, albumId, tileSize)} {@attach retryCover} alt="" loading="lazy" decoding="async" draggable="false" />{/each}
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
