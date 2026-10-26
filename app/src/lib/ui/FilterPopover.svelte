<script lang="ts">
	import { library } from '../library/library.svelte.ts';
	import { decadeCounts, genreCounts } from '../library/queries.ts';
	import { POPOVER } from '../tuning.ts';
	import { formatCount } from './format.ts';
	import { live } from './live.svelte.ts';
	import { ui } from './state.svelte.ts';

	const genres = live(genreCounts, []);
	const decades = live(decadeCounts, []);
	let element = $state<HTMLElement | null>(null);
	let position = $state({ left: 0, top: 0 });

	const options = $derived.by(() => {
		const total = library.meta?.albums ?? 0;
		if (ui.filterPopover?.kind === 'genre') return [['', 'All genres', total] as const, ...genres.value.map(({ genre, albums }) => [genre, genre, albums] as const)];
		return [['', 'All years', total] as const, ...decades.value.map(({ decade, albums }) => [String(decade), `${decade}s`, albums] as const)];
	});
	const selected = $derived(ui.filterPopover?.kind === 'genre' ? (ui.filters.genres[0] ?? '') : String(ui.filters.decades[0] ?? ''));

	$effect(() => {
		const anchor = ui.filterPopover;
		if (!anchor || !element) return;
		const size = element.getBoundingClientRect();
		position = {
			left: Math.max(POPOVER.edgeMarginPx, Math.min(anchor.left, innerWidth - size.width - POPOVER.edgeMarginPx)),
			top: Math.min(anchor.top + POPOVER.filterGapPx, innerHeight - size.height - POPOVER.filterBottomReservePx)
		};
	});

	function choose(value: string) {
		if (ui.filterPopover?.kind === 'genre') ui.filters = { ...ui.filters, genres: value ? [value] : [] };
		else ui.filters = { ...ui.filters, decades: value ? [Number(value)] : [] };
		ui.filterPopover = null;
	}
</script>

<svelte:window onpointerdown={(event) => ui.filterPopover && !element?.contains(event.target as Node) && !(event.target as Element).closest('.fbtn') && (ui.filterPopover = null)} />

<div id="filterPop" class="pop" class:open={!!ui.filterPopover} role="dialog" aria-label="Filter" bind:this={element} style:left="{position.left}px" style:top="{position.top}px">
	{#if ui.filterPopover}
		<p class="pop-title">{ui.filterPopover.kind === 'genre' ? 'Genre' : 'Decade'}</p>
		<div class="fopts">
			{#each options as [value, label, count] (value)}
				<button type="button" class="fopt" class:on={value === selected} onclick={() => choose(value)}>{label}<span>{formatCount(count)}</span></button>
			{/each}
		</div>
	{/if}
</div>
