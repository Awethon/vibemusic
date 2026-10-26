<script lang="ts">
	import type { Track } from '../library/queries.ts';
	import { isPlayingList, togglePlayList } from '../player/player.svelte.ts';
	import Icon from './Icon.svelte';

	let { tracks, sourceName, listKey, label = 'Play' }: { tracks: Track[]; sourceName: string; listKey: string; label?: string } = $props();
	const playing = $derived(isPlayingList(listKey));
</script>

<button class="btn" type="button" disabled={!tracks.length} onclick={() => togglePlayList(tracks, sourceName, listKey)}>
	<Icon name={playing ? 'pause' : 'play'} />{playing ? 'Pause' : label}
</button>
