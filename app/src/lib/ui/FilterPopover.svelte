<script lang="ts">
	import { formFactor } from './formFactor.svelte.ts';
	import { library } from '../library/library.svelte.ts';
	import { decadeCounts, genreCounts } from '../library/queries.ts';
	import { POPOVER } from '../tuning.ts';
	import { formatCount } from './format.ts';
	import { live } from './live.svelte.ts';
	import { ui } from './state.svelte.ts';

	const genres = live(genreCounts, [], []);
	const decades = live(decadeCounts, [], []);
	let element = $state<HTMLElement | null>(null);
	let position = $state({ left: 0, top: 0, above: false });

	const options = $derived.by(() => {
		const total = library.meta?.albums ?? 0;
		if (ui.filterPopover?.kind === 'genre')
			return [['', 'All genres', total] as const, ...genres.value.map(({ genre, albums }) => [genre, genre, albums] as const)];
		return [
			['', 'All years', total] as const,
			...decades.value.map(({ decade, albums }) => [String(decade), `${decade}s`, albums] as const)
		];
	});
	const selected = $derived(ui.filterPopover?.kind === 'genre' ? (ui.filters.genres[0] ?? '') : String(ui.filters.decades[0] ?? ''));

	function place() {
		const kind = ui.filterPopover?.kind;
		const button = kind ? document.querySelector(`.fbtn[data-filter="${kind}"]`) : null;
		if (!button || !element) return;
		const bar = (button.closest('.toolbar') ?? button).getBoundingClientRect();
		const anchor = button.getBoundingClientRect();
		const width = element.offsetWidth;
		const height = element.offsetHeight;
		const below = bar.bottom + POPOVER.filterGapPx;
		const above =
			below + height > innerHeight - POPOVER.filterBottomReservePx && bar.top - POPOVER.filterGapPx - height >= POPOVER.edgeMarginPx;
		position = {
			left: Math.max(Math.min(bar.left, anchor.left), Math.min(anchor.left, bar.right - width)),
			top: above ? bar.top - POPOVER.filterGapPx - height : below,
			above
		};
	}

	$effect(() => {
		if (!ui.filterPopover || !element) return;
		place();
		let frame = 0;
		const follow = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(place);
		};
		addEventListener('scroll', follow, true);
		addEventListener('resize', follow);
		return () => {
			cancelAnimationFrame(frame);
			removeEventListener('scroll', follow, true);
			removeEventListener('resize', follow);
		};
	});

	function choose(value: string) {
		if (ui.filterPopover?.kind === 'genre') ui.filters = { ...ui.filters, genres: value ? [value] : [] };
		else ui.filters = { ...ui.filters, decades: value ? [Number(value)] : [] };
		ui.filterPopover = null;
	}
</script>

<svelte:window
	onpointerdown={(event) =>
		ui.filterPopover &&
		!element?.contains(event.target as Node) &&
		!(event.target as Element).closest('.fbtn') &&
		(ui.filterPopover = null)}
/>

<div
	id="filterPop"
	class="pop"
	class:open={!!ui.filterPopover}
	class:above={position.above}
	role="dialog"
	aria-label="Filter"
	bind:this={element}
	style:left={formFactor.phone ? undefined : `${position.left}px`}
	style:top={formFactor.phone ? undefined : `${position.top}px`}
>
	{#if ui.filterPopover}
		<p class="pop-title">{ui.filterPopover.kind === 'genre' ? 'Genre' : 'Decade'}</p>
		<div class="fopts">
			{#each options as [value, label, count] (value)}
				<button type="button" class="fopt" class:on={value === selected} onclick={() => choose(value)}
					>{label}<span>{formatCount(count)}</span></button
				>
			{/each}
		</div>
	{/if}
</div>
