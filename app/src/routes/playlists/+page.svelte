<script lang="ts">
	import { resolve } from '$app/paths';
	import { allPlaylists, type PlaylistKind } from '#lib/library/queries.ts';
	import PlaylistCard from '#lib/ui/PlaylistCard.svelte';
	import { plural } from '#lib/ui/format.ts';
	import { live } from '#lib/ui/live.svelte.ts';

	const BLOCK_ITEM_LIMIT = 12;
	const titles: Record<PlaylistKind, string> = { own: 'Your playlists', smart: 'Smart playlists', genre: 'Genre playlists' };

	const playlists = live(allPlaylists, []);
	const blocks = $derived(
		(['own', 'smart', 'genre'] as const)
			.map((kind) => ({ kind, items: playlists.value.filter((playlist) => playlist.kind === kind) }))
			.filter((block) => block.items.length)
			.toSorted((a, b) => b.items.length - a.items.length)
	);
	const count = (kind: PlaylistKind) => blocks.find((block) => block.kind === kind)?.items.length ?? 0;
	const summary = $derived(
		[plural(count('own'), 'playlist'), count('smart') ? `${count('smart')} smart` : '', count('genre') ? `${count('genre')} by genre` : ''].filter((part) => part && !part.startsWith('0 ')).join(' · ')
	);
</script>

<header class="page-head">
	<h1>Playlists</h1>
	<p class="meta">{summary}</p>
</header>

{#each blocks as block (block.kind)}
	<section class="playlist-block">
		<h2>
			{titles[block.kind]} <small>{block.items.length}</small>
			{#if block.items.length > BLOCK_ITEM_LIMIT}<a class="more" href={resolve('/playlists/[kind]', { kind: block.kind })}>See all</a>{/if}
		</h2>
		<div class={block.kind === 'genre' ? 'grid small' : 'rows two-column'}>
			{#each block.items.slice(0, BLOCK_ITEM_LIMIT) as playlist (playlist.id)}<PlaylistCard {playlist} layout={block.kind === 'genre' ? 'genre' : 'row'} />{/each}
		</div>
	</section>
{/each}
