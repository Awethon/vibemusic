<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Track } from '../library/queries.ts';

	let { track, year = 0 }: { track: Track; year?: number } = $props();
</script>

{#if track.albumId}<a href={resolve('/artist/[id]', { id: track.albumArtistId || track.artistId })}>{track.artist}</a> ·
	<a href={resolve('/album/[id]', { id: track.albumId })}>{track.album}</a>{year ? ` · ${year}` : ''}{:else}Internet radio · {track.artist}{/if}
