<script lang="ts">
	import { history } from '../history.svelte.ts';
	import { albumsByIds, albumTracks, artistById, playlistById, search, type SearchResults } from '../library/queries.ts';
	import { playTracks } from '../player/player.svelte.ts';
	import { SEARCH } from '../tuning.ts';
	import { openAlbum, openArtist, openPlaylist } from './actions.ts';
	import Cover from './Cover.svelte';
	import { plural } from './format.ts';
	import { ui } from './state.svelte.ts';

	type Result = { key: string; title: string; subtitle: string; albumId: string | null; round: boolean; choose: () => void };

	let text = $state('');
	let selected = $state(0);
	let results = $state<{ heading: string; items: Result[] }[]>([]);

	function close() {
		ui.searchOpen = false;
	}

	function grouped(found: SearchResults): { heading: string; items: Result[] }[] {
		return [
			{ heading: 'Artists', items: found.artists.map((artist) => ({ key: `artist:${artist.id}`, title: artist.name, subtitle: `Artist · ${plural(artist.albumCount, 'album')}`, albumId: artist.newestAlbumId, round: true, choose: () => openArtist(artist.id) })) },
			{ heading: 'Albums', items: found.albums.map((album) => ({ key: `album:${album.id}`, title: album.name, subtitle: `Album · ${album.artist}`, albumId: album.id, round: false, choose: () => openAlbum(album.id) })) },
			{ heading: 'Playlists', items: found.playlists.map((playlist) => ({ key: `playlist:${playlist.id}`, title: playlist.name, subtitle: `Playlist · ${plural(playlist.songCount, 'track')}`, albumId: playlist.mosaicAlbumIds[0] ?? null, round: false, choose: () => openPlaylist(playlist.id) })) },
			{
				heading: 'Tracks',
				items: found.tracks.map((track) => ({
					key: `track:${track.id}`,
					title: track.title,
					subtitle: `${track.artist} · ${track.album}`,
					albumId: track.albumId,
					round: false,
					choose: async () => {
						const tracks = await albumTracks(track.albumId);
						playTracks(tracks, Math.max(0, tracks.findIndex((candidate) => candidate.id === track.id)), track.album, `album:${track.albumId}`);
					}
				}))
			}
		].filter((group) => group.items.length);
	}

	async function recent(): Promise<{ heading: string; items: Result[] }[]> {
		const items: Result[] = [];
		for (const item of history.items.slice(0, SEARCH.recentCount)) {
			if (item.kind === 'album') {
				const [album] = await albumsByIds([item.id]);
				if (album) items.push(grouped({ artists: [], albums: [album], playlists: [], tracks: [] })[0].items[0]);
			} else if (item.kind === 'artist') {
				const artist = await artistById(item.id);
				if (artist) items.push(grouped({ artists: [artist], albums: [], playlists: [], tracks: [] })[0].items[0]);
			} else {
				const playlist = await playlistById(item.id);
				if (playlist) items.push(grouped({ artists: [], albums: [], playlists: [playlist], tracks: [] })[0].items[0]);
			}
		}
		return items.length ? [{ heading: 'Jump back in', items }] : [];
	}

	$effect(() => {
		const query = text;
		let current = true;
		const load = query.trim()
			? search(query, { artists: SEARCH.artistLimit, albums: SEARCH.albumLimit, playlists: SEARCH.playlistLimit, tracks: SEARCH.trackLimit }).then(grouped)
			: recent();
		void load.then((groups) => {
			if (!current) return;
			results = groups;
			selected = 0;
		});
		return () => {
			current = false;
		};
	});

	const flat = $derived(results.flatMap((group) => group.items));

	function choose(result: Result | undefined) {
		if (!result) return;
		close();
		void result.choose();
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown') selected = Math.min(flat.length - 1, selected + 1);
		else if (event.key === 'ArrowUp') selected = Math.max(0, selected - 1);
		else if (event.key === 'Enter') choose(flat[selected]);
		else return;
		event.preventDefault();
	}
</script>

<div class="backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && close()}>
	<div class="search" role="dialog" aria-label="Search">
		<input placeholder="Search artists, albums, playlists, tracks" bind:value={text} {onkeydown} {@attach (node) => node.focus()} />
		{#each results as group (group.heading)}
			<h3>{group.heading}</h3>
			{#each group.items as result (result.key)}
				<button class="result" class:selected={flat[selected] === result} onclick={() => choose(result)} onmouseenter={() => (selected = flat.indexOf(result))}>
					<Cover albumId={result.albumId} size={80} round={result.round} />
					<span class="titles"><span class="title selectable">{result.title}</span><span class="artist selectable">{result.subtitle}</span></span>
				</button>
			{/each}
		{:else}
			{#if text.trim()}<p class="empty-state">Nothing found.</p>{/if}
		{/each}
	</div>
</div>
