<script lang="ts" generics="T">
	import { untrack, type Snippet } from 'svelte';
	import { mainScroller } from '../engine/dom.ts';
	import type { Geometry, Measure } from '../engine/geometry.ts';
	import { alphabet, registerLayout, showAlphabet, type AlphabetEntry } from '../engine/layout.svelte.ts';
	import { LAYOUT } from '../tuning.ts';

	let {
		items,
		key,
		measure,
		alphabetEntries = null,
		className = '',
		item
	}: {
		items: T[];
		key: (item: T) => string;
		measure: Measure;
		alphabetEntries?: AlphabetEntry[] | null;
		className?: string;
		item: Snippet<[T, number]>;
	} = $props();

	let container = $state<HTMLElement | null>(null);
	let geometry = $state<Geometry | null>(null);
	let range = $state({ first: 0, last: -1 });
	let scrollFrame = 0;

	const rowCount = $derived(geometry ? Math.ceil(items.length / geometry.columns) : 0);
	const visible = $derived(items.slice(range.first, range.last + 1).map((value, offset) => ({ value, index: range.first + offset })));

	function offsetWithinScroller(scroller: HTMLElement) {
		return container!.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
	}

	const stickyHeight = (scroller: HTMLElement) => scroller.querySelector<HTMLElement>('.toolbar')?.offsetHeight ?? 0;

	function updateRange() {
		const scroller = mainScroller();
		if (!container || !geometry || !scroller) return;
		const scrolledInto = scroller.scrollTop - offsetWithinScroller(scroller);
		const rows = Math.ceil(items.length / geometry.columns);
		const firstRow = Math.max(0, Math.floor(scrolledInto / geometry.rowHeight) - LAYOUT.virtualOverscanRows);
		const lastRow = Math.min(
			rows - 1,
			Math.floor((scrolledInto + scroller.clientHeight) / geometry.rowHeight) + LAYOUT.virtualOverscanRows
		);
		const first = firstRow * geometry.columns;
		const last = Math.min(items.length - 1, (lastRow + 1) * geometry.columns - 1);
		if (first !== range.first || last !== range.last) range = { first, last };
		if (alphabetEntries) {
			const probeIndex =
				Math.floor(Math.max(0, scrolledInto + stickyHeight(scroller) + LAYOUT.alphabetProbeOffsetPx) / geometry.rowHeight) *
				geometry.columns;
			let entryIndex = 0;
			for (let index = 0; index < alphabetEntries.length; index++) {
				if (alphabetEntries[index].index <= probeIndex) entryIndex = index;
				else break;
			}
			alphabet.current = entryIndex;
		}
	}

	function layout() {
		if (!container) return;
		geometry = measure(container.clientWidth);
		updateRange();
	}

	function reflow() {
		if (!container || !geometry) return;
		const next = measure(container.clientWidth);
		if (next.columns !== geometry.columns) {
			layout();
			return;
		}
		if (Math.abs(next.itemWidth - geometry.itemWidth) < LAYOUT.virtualReflowMinWidthChangePx) return;
		geometry = next;
		updateRange();
	}

	function jump(entryIndex: number) {
		const scroller = mainScroller();
		const entry = alphabetEntries?.[entryIndex];
		if (!scroller || !geometry || !entry) return;
		const row = Math.floor(entry.index / geometry.columns);
		scroller.scrollTop = offsetWithinScroller(scroller) + row * geometry.rowHeight - stickyHeight(scroller) - LAYOUT.alphabetJumpOffsetPx;
	}

	$effect(() => {
		void items.length;
		void measure;
		void container;
		untrack(layout);
	});

	$effect(() => {
		const entries = alphabetEntries;
		untrack(() => {
			showAlphabet(entries, jump);
			updateRange();
		});
		return () => showAlphabet(null, null);
	});

	$effect(() => {
		const scroller = mainScroller();
		const onScroll = () => {
			if (scrollFrame) return;
			scrollFrame = requestAnimationFrame(() => {
				scrollFrame = 0;
				updateRange();
			});
		};
		scroller?.addEventListener('scroll', onScroll, { passive: true });
		const unregister = registerLayout({
			needsRefill: () => !!container && !!geometry && measure(container.clientWidth).columns !== geometry.columns,
			refill: layout,
			reflow
		});
		return () => {
			scroller?.removeEventListener('scroll', onScroll);
			cancelAnimationFrame(scrollFrame);
			unregister();
		};
	});
</script>

<div class="vgrid {className}" id="vlist" bind:this={container} style:height="{geometry ? rowCount * geometry.rowHeight : 0}px">
	{#if geometry}
		{#each visible as cell (key(cell.value))}
			<div
				class="vcell"
				data-id={key(cell.value)}
				style:width="{geometry.itemWidth}px"
				style:transform="translate({(cell.index % geometry.columns) * (geometry.itemWidth + geometry.gapX)}px, {Math.floor(
					cell.index / geometry.columns
				) * geometry.rowHeight}px)"
			>
				{@render item(cell.value, cell.index)}
			</div>
		{/each}
	{/if}
</div>
