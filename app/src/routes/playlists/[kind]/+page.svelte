<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { allPlaylists } from '#lib/library/queries.ts';
	import PlaylistCard from '#lib/ui/PlaylistCard.svelte';
	import { plural } from '#lib/ui/format.ts';
	import { live } from '#lib/ui/live.svelte.ts';

	const titles: Record<string, string> = { own: 'Your playlists', smart: 'Smart playlists', genre: 'Genre playlists' };
	const notes: Record<string, string> = { own: 'made by you', smart: 'update automatically', genre: 'built from your albums' };
	const kind = $derived(page.params.kind ?? 'own');
	const playlists = live(allPlaylists, []);
	const shown = $derived(playlists.value.filter((playlist) => playlist.kind === kind));
</script>

<a class="crumb" href={resolve('/playlists')}>← Playlists</a>
<header class="page-head">
	<h1>{titles[kind] ?? 'Playlists'}</h1>
	<p class="meta">{plural(shown.length, 'playlist')} · {notes[kind] ?? ''}</p>
</header>
<div class="grid">
	{#each shown as playlist (playlist.id)}<PlaylistCard {playlist} />{/each}
</div>
