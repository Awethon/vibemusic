<script lang="ts">
	import type { Playlist, Track } from '../library/queries.ts';
	import TrackRow from './TrackRow.svelte';

	let {
		tracks,
		sourceName,
		listKey,
		numbering = 'index',
		showAlbum = false,
		alwaysShowArtist = false,
		discHeadings = false,
		playlist
	}: {
		tracks: Track[];
		sourceName: string;
		listKey: string;
		numbering?: 'track' | 'index';
		showAlbum?: boolean;
		alwaysShowArtist?: boolean;
		discHeadings?: boolean;
		playlist?: Playlist;
	} = $props();

	const multiDisc = $derived(discHeadings && new Set(tracks.map((track) => track.discNo)).size > 1);
</script>

<div class="tracks" class:wide={showAlbum}>
	{#each tracks as track, index (index)}
		{#if multiDisc && (index === 0 || tracks[index - 1].discNo !== track.discNo)}
			<p class="disc">Disc {track.discNo}</p>
		{/if}
		<TrackRow
			{tracks}
			{index}
			{sourceName}
			{listKey}
			{playlist}
			number={numbering === 'track' ? track.trackNo || '' : index + 1}
			showArtist={alwaysShowArtist || track.artistId !== track.albumArtistId}
			{showAlbum}
		/>
	{/each}
</div>
