<script lang="ts">
	import { alphabet } from '../engine/layout.svelte.ts';
</script>

<nav id="az" aria-label="Jump to letter">
	{#each alphabet.entries as entry, index (index)}
		<button type="button" class:cur={index === alphabet.current} title={entry.label} onclick={() => alphabet.jump?.(index)}
			>{entry.label}</button
		>
	{/each}
</nav>
