<script lang="ts">
	import type { Track } from '../library/queries.ts';
	import { isPlayingList, togglePlayList } from '../player/player.svelte.ts';

	let { tracks, sourceName, listKey, label = 'Play' }: { tracks: Track[]; sourceName: string; listKey: string; label?: string } = $props();
	const playing = $derived(isPlayingList(listKey));
</script>

<button class="primary" disabled={!tracks.length} onclick={() => togglePlayList(tracks, sourceName, listKey)}>{playing ? 'Pause' : label}</button>
