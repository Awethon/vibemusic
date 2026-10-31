<script lang="ts">
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import { mainScroller } from '../engine/dom.ts';
	import { registerLayout } from '../engine/layout.svelte.ts';
	import type { Playlist, PlaylistKind } from '../library/queries.ts';
	import { BENTO } from '../tuning.ts';
	import { formFactor } from './formFactor.svelte.ts';
	import PlaylistRow from './PlaylistRow.svelte';
	import GenreTile from './GenreTile.svelte';

	type Block = { kind: PlaylistKind; title: string; playlists: Playlist[]; span: readonly number[] };
	type Plan = { columns: number; rows: number; tileSize: number; itemCount: number };

	let { blocks }: { blocks: Block[] } = $props();

	let bento = $state<HTMLElement | null>(null);
	let height = $state<number>(BENTO.minHeightPx);
	let plans = $state<Record<string, Plan>>({});

	function fitHeight() {
		const scroller = mainScroller();
		if (!bento || !scroller) return;
		const top = bento.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
		const bottomPadding = parseFloat(getComputedStyle(scroller).paddingBottom);
		height = Math.max(BENTO.minHeightPx, scroller.clientHeight - top - bottomPadding);
	}

	function planFor(kind: PlaylistKind, body: HTMLElement): Plan {
		const width = body.clientWidth;
		const bodyHeight = body.clientHeight;
		if (kind === 'genre') {
			const gap = BENTO.genreTileGapPx;
			const columns = Math.max(1, Math.floor((width + gap) / (Math.min(bodyHeight, BENTO.genreTileMaxSizePx) + gap)));
			const tileSize = Math.floor(Math.min(bodyHeight, (width - gap * (columns - 1)) / columns));
			const rows = Math.max(1, Math.floor((bodyHeight + gap) / (tileSize + gap)));
			return { columns, rows, tileSize, itemCount: columns * rows };
		}
		const columns = Math.max(1, Math.floor((width + BENTO.rowColumnGapPx) / (BENTO.rowMinWidthPx + BENTO.rowColumnGapPx)));
		const rows = Math.max(1, Math.floor((bodyHeight + BENTO.rowGapPx) / (BENTO.rowHeightPx + BENTO.rowGapPx)));
		return { columns, rows, tileSize: 0, itemCount: columns * rows };
	}

	function measurePlans(): Record<string, Plan> {
		const measured: Record<string, Plan> = {};
		for (const body of bento?.querySelectorAll<HTMLElement>('.bb-body') ?? []) {
			const kind = body.dataset.body as PlaylistKind;
			measured[kind] = planFor(kind, body);
		}
		return measured;
	}

	const signature = (all: Record<string, Plan>) => Object.entries(all).map(([kind, plan]) => `${kind}:${plan.itemCount}|${plan.columns}|${plan.tileSize}`).join(',');

	function stackedPlans(): Record<string, Plan> {
		return Object.fromEntries(
			blocks.map((block) => [
				block.kind,
				block.kind === 'genre'
					? { columns: BENTO.phoneGenreColumns, rows: BENTO.phoneGenreRows, tileSize: 0, itemCount: BENTO.phoneGenreColumns * BENTO.phoneGenreRows }
					: { columns: 1, rows: BENTO.phoneListRows, tileSize: 0, itemCount: BENTO.phoneListRows }
			])
		);
	}

	function refit() {
		if (formFactor.phone) {
			const stacked = stackedPlans();
			if (signature(stacked) !== signature(plans)) plans = stacked;
			return;
		}
		fitHeight();
		const measured = measurePlans();
		if (signature(measured) !== signature(plans)) plans = measured;
	}

	$effect(() => {
		void blocks;
		void bento;
		void formFactor.phone;
		untrack(refit);
		const frame = requestAnimationFrame(refit);
		const unregister = registerLayout({
			needsRefill: () => {
				if (formFactor.phone) return false;
				fitHeight();
				return Object.entries(measurePlans()).some(([kind, plan]) => plans[kind]?.itemCount !== plan.itemCount || plans[kind]?.columns !== plan.columns);
			},
			refill: refit,
			reflow: refit
		});
		return () => {
			cancelAnimationFrame(frame);
			unregister();
		};
	});
</script>

<div class="bento" class:stacked={formFactor.phone} id="bento" bind:this={bento} style:height={formFactor.phone ? undefined : `${height}px`}>
	{#each blocks as block (block.kind)}
		{@const plan = plans[block.kind]}
		<section class="bento-block" data-kind={block.kind} style:grid-column={formFactor.phone ? undefined : `span ${block.span[0]}`} style:grid-row={formFactor.phone ? undefined : `span ${block.span[1]}`}>
			<div class="bb-head">
				<h2 class="section-title">{block.title} <small>{block.playlists.length}</small></h2>
				<a class="see-all" href={resolve('/playlists/[kind]', { kind: block.kind })} hidden={!!plan && block.playlists.length <= plan.itemCount}>See all</a>
			</div>
			<div
				class="bb-body"
				class:tiles={block.kind === 'genre'}
				data-body={block.kind}
				style:grid-template-columns={plan ? (plan.tileSize ? `repeat(${plan.columns}, ${plan.tileSize}px)` : `repeat(${plan.columns}, minmax(0, 1fr))`) : undefined}
				style:grid-auto-rows={plan ? (block.kind !== 'genre' ? `${BENTO.rowHeightPx}px` : plan.tileSize ? `${plan.tileSize}px` : 'auto') : undefined}
			>
				{#if plan}
					{#each block.playlists.slice(0, plan.itemCount) as playlist (playlist.id)}
						{#if block.kind === 'genre'}<GenreTile {playlist} />{:else}<PlaylistRow {playlist} />{/if}
					{/each}
				{/if}
			</div>
		</section>
	{/each}
</div>
