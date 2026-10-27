<script lang="ts">
	import { viewEnter } from '#lib/ui/viewEnter.ts';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { allPlaylists } from '#lib/library/queries.ts';
	import PlaylistTile from '#lib/ui/PlaylistTile.svelte';
	import { plural } from '#lib/ui/format.ts';
	import { live } from '#lib/ui/live.svelte.ts';

	const kinds: Record<string, { title: string; note: string }> = {
		own: { title: 'Your playlists', note: '' },
		smart: { title: 'Smart playlists', note: 'update automatically' },
		genre: { title: 'Genre playlists', note: 'your top songs in each genre' }
	};
	const kind = $derived(page.params.kind ?? 'own');
	const playlists = live(allPlaylists, []);
	const shown = $derived(playlists.value.filter((playlist) => playlist.kind === kind));
</script>

<section class="view" {@attach viewEnter}>
	<a class="crumb" href={resolve('/playlists')}>← Playlists</a>
	<div class="vhead">
		<div>
			<h1 class="display">{kinds[kind]?.title ?? 'Playlists'}</h1>
			<p class="sub">{plural(shown.length, 'playlist')}{kinds[kind]?.note ? ` · ${kinds[kind].note}` : ''}</p>
		</div>
	</div>
	<div class="pl-grid">
		{#each shown as playlist (playlist.id)}<PlaylistTile {playlist} variant="card" />{/each}
	</div>
</section>
