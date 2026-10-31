<script lang="ts" generics="T">
	import { untrack, type Snippet } from 'svelte';
	import { registerLayout } from '../engine/layout.svelte.ts';
	import { formFactor } from './formFactor.svelte.ts';

	type PhoneShelf = { columns: number; rows: number; gapPx: number } | { scrollItemPx: number; rows: number; gapPx: number; limit: number };

	let { id, items, minItemWidthPx, gapPx, rows, phone, item }: { id: string; items: T[]; minItemWidthPx: number; gapPx: number; rows: number; phone: PhoneShelf; item: Snippet<[T]> } = $props();

	let container = $state<HTMLElement | null>(null);
	let columns = $state(0);

	const columnsThatFit = () => (container ? Math.max(1, Math.floor((container.clientWidth + gapPx) / (minItemWidthPx + gapPx))) : 0);

	$effect(() => {
		void container;
		columns = untrack(columnsThatFit);
		return registerLayout({
			needsRefill: () => columnsThatFit() !== columns,
			refill: () => (columns = columnsThatFit()),
			reflow: () => {}
		});
	});
</script>

{#if formFactor.phone && 'scrollItemPx' in phone}
	<div class="shelf scroll" {id} style:--gap="{phone.gapPx}px" style:grid-template-rows="repeat({phone.rows}, auto)" style:grid-auto-columns="{phone.scrollItemPx}px">
		{#each items.slice(0, phone.limit) as value, index (index)}
			{@render item(value)}
		{/each}
	</div>
{:else if formFactor.phone && 'columns' in phone}
	<div class="shelf" {id} style:--gap="{phone.gapPx}px" style:grid-template-columns="repeat({phone.columns}, minmax(0, 1fr))">
		{#each items.slice(0, phone.columns * phone.rows) as value, index (index)}
			{@render item(value)}
		{/each}
	</div>
{:else}
	<div class="shelf" {id} bind:this={container} style:--gap="{gapPx}px" style:grid-template-columns={columns ? `repeat(${columns}, minmax(0, 1fr))` : undefined}>
		{#each items.slice(0, columns * rows) as value, index (index)}
			{@render item(value)}
		{/each}
	</div>
{/if}
