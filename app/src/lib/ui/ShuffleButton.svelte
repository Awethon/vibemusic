<script lang="ts">
	import { playerQueue, shuffleFor, toggleShuffle } from '../player/player.svelte.ts';
	import Icon from './Icon.svelte';

	// With a listKey this is the list's own toggle (album or playlist page); without one it follows
	// whatever list is playing (player controls).
	let { listKey, className = '' }: { listKey?: string; className?: string } = $props();
	const key = $derived(listKey ?? playerQueue().sourceKey);
	const on = $derived(listKey ? shuffleFor(listKey) : playerQueue().shuffled);
</script>

<button
	class="icon-btn shuffle {className}"
	class:on
	type="button"
	aria-label="Shuffle"
	aria-pressed={on}
	title={on ? 'Shuffle on' : 'Shuffle off'}
	disabled={!key}
	onclick={() => toggleShuffle(key)}><Icon name="shuffle" /></button
>
