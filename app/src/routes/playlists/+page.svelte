<script lang="ts">
	import { viewEnter } from '#lib/ui/viewEnter.ts';
	import { allPlaylists, type PlaylistKind } from '#lib/library/queries.ts';
	import { BENTO } from '#lib/tuning.ts';
	import Bento from '#lib/ui/Bento.svelte';
	import { plural } from '#lib/ui/format.ts';
	import { live } from '#lib/ui/live.svelte.ts';

	const titles: Record<PlaylistKind, string> = { own: 'Your playlists', smart: 'Smart playlists', genre: 'Genre playlists', artist: 'Artist playlists' };
	const playlists = live(allPlaylists, []);

	const blocks = $derived.by(() => {
		const kinds = (['own', 'smart', 'genre'] as const)
			.map((kind) => ({ kind, title: titles[kind], playlists: playlists.value.filter((playlist) => playlist.kind === kind) }))
			.filter((block) => block.playlists.length)
			.toSorted((a, b) => b.playlists.length - a.playlists.length);
		const spans = BENTO.blockSpansByKindCount[kinds.length as 1 | 2 | 3] ?? BENTO.blockSpansByKindCount[3];
		return kinds.map((block, index) => ({ ...block, span: spans[index] }));
	});
	const count = (kind: PlaylistKind) => playlists.value.filter((playlist) => playlist.kind === kind).length;
	const summary = $derived(`${plural(playlists.value.length, 'playlist')}${count('smart') ? ` · ${count('smart')} smart` : ''}${count('genre') ? ` · ${count('genre')} by genre` : ''}`);
</script>

<section class="view" {@attach viewEnter}>
	<div class="vhead"><div><h1 class="display">Playlists</h1><p class="sub">{summary}</p></div></div>
	{#if blocks.length}<Bento {blocks} />{/if}
</section>
