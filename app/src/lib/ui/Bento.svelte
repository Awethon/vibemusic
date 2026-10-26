<script lang="ts">
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import { mainScroller } from '../engine/dom.ts';
	import { registerLayout } from '../engine/layout.svelte.ts';
	import type { Playlist, PlaylistKind } from '../library/queries.ts';
	import { BENTO } from '../tuning.ts';
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

	function refit() {
		fitHeight();
		const measured = measurePlans();
		if (signature(measured) !== signature(plans)) plans = measured;
	}

	$effect(() => {
		void blocks;
		void bento;
		untrack(refit);
		const frame = requestAnimationFrame(refit);
		const unregister = registerLayout({
			needsRefill: () => {
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

<div class="bento" id="bento" bind:this={bento} style:height="{height}px">
	{#each blocks as block (block.kind)}
		{@const plan = plans[block.kind]}
		<section class="bento-block" data-kind={block.kind} style:grid-column="span {block.span[0]}" style:grid-row="span {block.span[1]}">
			<div class="bb-head">
				<h2 class="section-title">{block.title} <small>{block.playlists.length}</small></h2>
				<a class="see-all" href={resolve('/playlists/[kind]', { kind: block.kind })} hidden={!!plan && block.playlists.length <= plan.itemCount}>See all</a>
			</div>
			<div
				class="bb-body"
				class:tiles={block.kind === 'genre'}
				data-body={block.kind}
				style:grid-template-columns={plan ? (block.kind === 'genre' ? `repeat(${plan.columns}, ${plan.tileSize}px)` : `repeat(${plan.columns}, minmax(0, 1fr))`) : undefined}
				style:grid-auto-rows={plan ? `${block.kind === 'genre' ? plan.tileSize : BENTO.rowHeightPx}px` : undefined}
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
