<script lang="ts">
	let { buckets, target }: { buckets: { label: string; index: number }[]; target: string } = $props();

	function jump(index: number) {
		document.querySelector(`[data-index-target="${target}"] > :nth-child(${index + 1})`)?.scrollIntoView({ block: 'start' });
	}
</script>

{#if buckets.length > 1}
	<nav class="alphabet">
		{#each buckets as bucket (bucket.label)}
			<button onclick={() => jump(bucket.index)}>{bucket.label}</button>
		{/each}
	</nav>
{/if}
