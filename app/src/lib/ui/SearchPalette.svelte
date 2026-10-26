<script lang="ts">
	import { previewPalette } from '../engine/palette.ts';
	import { history } from '../history.svelte.ts';
	import { albumsByIds, albumTracks, artistById, playlistById, search, type Album, type Artist, type Playlist, type Track } from '../library/queries.ts';
	import { playTracks } from '../player/player.svelte.ts';
	import { SEARCH } from '../tuning.ts';
	import { openAlbum, openArtist, openPlaylist } from './actions.ts';
	import Cover from './Cover.svelte';
	import { plural } from './format.ts';
	import Icon from './Icon.svelte';
	import { playlistKindLabel } from './playlistText.ts';
	import { ui } from './state.svelte.ts';

	type Result = { kind: 'artist'; item: Artist } | { kind: 'album'; item: Album } | { kind: 'playlist'; item: Playlist } | { kind: 'track'; item: Track };
	type Group = { title: string; results: Result[] };

	let text = $state('');
	let groups = $state<Group[]>([]);
	let selected = $state(0);
	let input = $state<HTMLInputElement | null>(null);
	let resultsBox = $state<HTMLElement | null>(null);
	const flat = $derived(groups.flatMap((group) => group.results));

	const albumIdOf = (result: Result) => (result.kind === 'track' ? result.item.albumId : result.kind === 'album' ? result.item.id : null);

	async function recent(): Promise<Group[]> {
		const results: Result[] = [];
		for (const entry of history.items.slice(0, SEARCH.recentCount)) {
			if (entry.kind === 'album') {
				const [album] = await albumsByIds([entry.id]);
				if (album) results.push({ kind: 'album', item: album });
			} else if (entry.kind === 'artist') {
				const artist = await artistById(entry.id);
				if (artist) results.push({ kind: 'artist', item: artist });
			} else {
				const playlist = await playlistById(entry.id);
				if (playlist) results.push({ kind: 'playlist', item: playlist });
			}
		}
		return results.length ? [{ title: 'Jump back in', results }] : [];
	}

	async function matches(query: string): Promise<Group[]> {
		const found = await search(query, { artists: SEARCH.artistLimit, albums: SEARCH.albumLimit, playlists: SEARCH.playlistLimit, tracks: SEARCH.trackLimit });
		return [
			{ title: 'Artists', results: found.artists.map((item) => ({ kind: 'artist', item }) as Result) },
			{ title: 'Albums', results: found.albums.map((item) => ({ kind: 'album', item }) as Result) },
			{ title: 'Playlists', results: found.playlists.map((item) => ({ kind: 'playlist', item }) as Result) },
			{ title: 'Tracks', results: found.tracks.map((item) => ({ kind: 'track', item }) as Result) }
		].filter((group) => group.results.length);
	}

	$effect(() => {
		if (!ui.searchOpen) return;
		const query = text.trim();
		let current = true;
		void (query ? matches(query) : recent()).then((next) => {
			if (!current) return;
			groups = next;
			selected = 0;
		});
		return () => {
			current = false;
		};
	});

	$effect(() => {
		if (!ui.searchOpen) return;
		const result = flat[selected];
		resultsBox?.querySelectorAll('.pal-item')[selected]?.scrollIntoView({ block: 'nearest' });
		if (result) previewPalette(albumIdOf(result));
	});

	$effect(() => {
		if (ui.searchOpen) {
			text = '';
			input?.focus();
		} else input?.blur();
	});

	function close() {
		ui.searchOpen = false;
		previewPalette(null);
	}

	async function choose(result: Result | undefined) {
		if (!result) return;
		close();
		if (result.kind === 'artist') void openArtist(result.item.id);
		else if (result.kind === 'album') void openAlbum(result.item.id);
		else if (result.kind === 'playlist') void openPlaylist(result.item.id);
		else {
			const track = result.item;
			const tracks = await albumTracks(track.albumId);
			playTracks(tracks, Math.max(0, tracks.findIndex((candidate) => candidate.id === track.id)), track.album, `album:${track.albumId}`);
		}
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown') selected = Math.min(flat.length - 1, selected + 1);
		else if (event.key === 'ArrowUp') selected = Math.max(0, selected - 1);
		else if (event.key === 'Enter') void choose(flat[selected]);
		else return;
		event.preventDefault();
	}
</script>

<div id="palette" class:open={ui.searchOpen} role="dialog" aria-label="Search" tabindex="-1" onmousedown={(event) => event.target === event.currentTarget && close()}>
	<div class="pal-box">
		<div class="pal-input">
			<span class="pal-ico"><Icon name="search" /></span>
			<input bind:this={input} bind:value={text} type="text" placeholder="Artists, albums, tracks…" autocomplete="off" spellcheck="false" {onkeydown} />
			<kbd>esc</kbd>
		</div>
		<div class="pal-results" bind:this={resultsBox}>
			{#each groups as group (group.title)}
				<p class="pal-group">{group.title}</p>
				{#each group.results as result (result.kind + result.item.id)}
					{@const index = flat.indexOf(result)}
					<button type="button" class="pal-item" class:sel={index === selected} onclick={() => choose(result)} onmousemove={() => index !== selected && (selected = index)}>
						{#if result.kind === 'artist'}
							<span class="ai">{result.item.name.charAt(0).toUpperCase()}</span>
							<div><b>{result.item.name}</b><small>Artist · {plural(result.item.albumCount, 'album')}</small></div>
							<em>Open</em>
						{:else if result.kind === 'album'}
							<Cover albumId={result.item.id} size={80} />
							<div><b>{result.item.name}</b><small>Album · {result.item.artist}{result.item.year ? ` · ${result.item.year}` : ''}</small></div>
							<em>Open</em>
						{:else if result.kind === 'playlist'}
							<Cover albumId={result.item.mosaicAlbumIds[0]} size={80} />
							<div><b>{result.item.name}</b><small>{playlistKindLabel(result.item)} · {plural(result.item.songCount, 'track')}</small></div>
							<em>Open</em>
						{:else}
							<Cover albumId={result.item.albumId} size={80} />
							<div><b>{result.item.title}</b><small>{result.item.artist} · {result.item.album}</small></div>
							<em>Play</em>
						{/if}
					</button>
				{/each}
			{:else}
				{#if text.trim()}<p class="pal-empty">Nothing matches “{text}”</p>{/if}
			{/each}
		</div>
	</div>
</div>
