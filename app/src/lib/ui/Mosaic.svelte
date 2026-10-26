<script lang="ts">
	import Cover from './Cover.svelte';

	let { albumIds, size = 160 }: { albumIds: string[]; size?: number } = $props();
	const tiles = $derived(albumIds.length >= 4 ? albumIds.slice(0, 4) : albumIds.length ? [0, 1, 2, 3].map((index) => albumIds[index % albumIds.length]) : []);
</script>

<div class="mosaic">
	{#each tiles as albumId, index (index)}
		<Cover {albumId} size={Math.round(size / 2)} />
	{:else}
		<div class="cover empty"></div>
	{/each}
</div>
