<script lang="ts">
	import { viewEnter } from '#lib/ui/viewEnter.ts';
	import { allPlaylists, radioTracks, type PlaylistKind } from '#lib/library/queries.ts';
	import { BENTO } from '#lib/tuning.ts';
	import Bento from '#lib/ui/Bento.svelte';
	import { plural } from '#lib/ui/format.ts';
	import { live } from '#lib/ui/live.svelte.ts';
	import { player, playerQueue, playTrackInList } from '#lib/player/player.svelte.ts';

	const titles: Record<PlaylistKind, string> = { own: 'Your playlists', smart: 'Smart playlists', genre: 'Genre playlists', artist: 'Artist playlists' };
	const playlists = live(allPlaylists, []);
	const stations = live(radioTracks, []);

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
	<div class="vhead">
		<div><h1 class="display">Playlists</h1><p class="sub">{summary}</p></div>
		{#if stations.value.length}
			<div class="radio-row" role="group" aria-label="Radio">
				<span class="radio-label">Radio</span>
				{#each stations.value as station, index (station.id)}
					{@const on = playerQueue().currentTrackId === station.id}
					<button class="radio-chip" class:on type="button" title={station.artist} onclick={() => playTrackInList(stations.value, index, 'Radio', 'radio')}>
						{#if on && player.playing}<span class="live-badge"><i></i></span>{/if}{station.title}
					</button>
				{/each}
			</div>
		{/if}
	</div>
	{#if blocks.length}<Bento {blocks} />{/if}
</section>
