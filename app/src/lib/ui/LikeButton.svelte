<script lang="ts">
	import { currentTrack, toggleLike } from '../player/player.svelte.ts';
	import Icon from './Icon.svelte';

	let { className = '' }: { className?: string } = $props();
	const track = $derived(currentTrack());
</script>

<button class="like {className}" class:on={!!track?.starred} type="button" aria-label="Like" aria-pressed={!!track?.starred} onclick={() => track && toggleLike(track)}><Icon name="heart" /></button>
