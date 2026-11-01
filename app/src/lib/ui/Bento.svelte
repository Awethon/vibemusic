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

	type Block = { kind: PlaylistKind; title: string; playlists: Playlist[] };
	type Plan = { columns: number; rows: number; tileSize: number; itemCount: number; bodyHeight: number };
	type Geometry = { kind: PlaylistKind; width: number; chrome: number; count: number };

	let { blocks }: { blocks: Block[] } = $props();

	let bento = $state<HTMLElement | null>(null);
	let plans = $state<Record<string, Plan>>({});

	const columnCount = $derived(Math.min(blocks.length, 2));

	function fillHeight() {
		const scroller = mainScroller();
		if (!bento || !scroller) return BENTO.minHeightPx;
		const top = bento.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
		const bottomPadding = parseFloat(getComputedStyle(scroller).paddingBottom);
		return Math.max(BENTO.minHeightPx, scroller.clientHeight - top - bottomPadding);
	}

	function measureGeometry(): Geometry[] {
		return [...(bento?.querySelectorAll<HTMLElement>('.bb-body') ?? [])].map((body) => {
			const kind = body.dataset.body as PlaylistKind;
			return { kind, width: body.clientWidth, chrome: (body.parentElement?.offsetHeight ?? 0) - body.offsetHeight, count: blocks.find((block) => block.kind === kind)?.playlists.length ?? 0 };
		});
	}

	function planFor(item: Geometry, room: number): Plan {
		if (item.kind === 'genre') {
			const gap = BENTO.genreTileGapPx;
			const columns = Math.max(1, Math.min(BENTO.genreMaxColumns, Math.floor((item.width + gap) / (Math.min(room, BENTO.genreTileMinPx) + gap))));
			const tileSize = Math.floor(Math.min(room, (item.width - gap * (columns - 1)) / columns));
			const rows = Math.max(1, Math.min(BENTO.genreMaxRows, Math.floor((room + gap) / (tileSize + gap)), Math.ceil(item.count / columns)));
			return { columns, rows, tileSize, itemCount: columns * rows, bodyHeight: rows * tileSize + (rows - 1) * gap };
		}
		const columns = Math.max(1, Math.min(BENTO.listMaxColumns, Math.floor((item.width + BENTO.rowColumnGapPx) / (BENTO.rowMinWidthPx + BENTO.rowColumnGapPx))));
		const rows = Math.max(1, Math.min(BENTO.listMaxRows, Math.floor((room + BENTO.rowGapPx) / (BENTO.rowHeightPx + BENTO.rowGapPx)), Math.ceil(item.count / columns)));
		return { columns, rows, tileSize: 0, itemCount: columns * rows, bodyHeight: rows * BENTO.rowHeightPx + (rows - 1) * BENTO.rowGapPx };
	}

	function stackedRoom(stack: Geometry[], height: number, gap: number) {
		const room = height - gap * (stack.length - 1) - stack.reduce((sum, item) => sum + item.chrome, 0);
		const wanted = stack.map((item) => planFor(item, Infinity).bodyHeight);
		const share = room / stack.length;
		const spare = wanted.reduce((sum, need) => sum + Math.max(0, share - need), 0);
		const short = wanted.filter((need) => need > share).length;
		return wanted.map((need) => (need <= share ? need : share + spare / Math.max(1, short)));
	}

	function fittedPlans(): Record<string, Plan> {
		const height = fillHeight();
		const gap = bento ? parseFloat(getComputedStyle(bento).rowGap) || 0 : 0;
		const [lead, ...rest] = measureGeometry();
		if (!lead) return {};
		const leadPlan = planFor(lead, height - lead.chrome);
		const restRooms = stackedRoom(rest, height, gap);
		return Object.fromEntries([[lead.kind, leadPlan], ...rest.map((item, index) => [item.kind, planFor(item, restRooms[index])])]);
	}

	const signature = (all: Record<string, Plan>) => Object.entries(all).map(([kind, plan]) => `${kind}:${plan.itemCount}|${plan.columns}|${plan.tileSize}|${plan.bodyHeight}`).join(',');

	function stackedPlans(): Record<string, Plan> {
		return Object.fromEntries(
			blocks.map((block) => [
				block.kind,
				block.kind === 'genre'
					? { columns: BENTO.phoneGenreColumns, rows: BENTO.phoneGenreRows, tileSize: 0, itemCount: BENTO.phoneGenreColumns * BENTO.phoneGenreRows, bodyHeight: 0 }
					: { columns: 1, rows: BENTO.phoneListRows, tileSize: 0, itemCount: BENTO.phoneListRows, bodyHeight: 0 }
			])
		);
	}

	const currentPlans = () => (formFactor.phone ? stackedPlans() : fittedPlans());

	function refit() {
		const next = currentPlans();
		if (signature(next) !== signature(plans)) plans = next;
	}

	$effect(() => {
		void blocks;
		void bento;
		void formFactor.phone;
		untrack(refit);
		const frame = requestAnimationFrame(refit);
		const unregister = registerLayout({
			needsRefill: () => signature(currentPlans()) !== signature(plans),
			refill: refit,
			reflow: refit
		});
		return () => {
			cancelAnimationFrame(frame);
			unregister();
		};
	});
</script>

<div class="bento" class:stacked={formFactor.phone} id="bento" bind:this={bento} style:grid-template-columns={formFactor.phone ? undefined : `repeat(${columnCount}, minmax(0, 1fr))`} style:grid-template-rows={!formFactor.phone && blocks.length > 2 ? 'auto 1fr' : undefined}>
	{#each blocks as block, index (block.kind)}
		{@const plan = plans[block.kind]}
		<section class="bento-block" data-kind={block.kind} style:grid-row={!formFactor.phone && blocks.length > 2 && index === 0 ? 'span 2' : undefined}>
			<div class="bb-head">
				<h2 class="section-title">{block.title} <small>{block.playlists.length}</small></h2>
				<a class="see-all" href={resolve('/playlists/[kind]', { kind: block.kind })} hidden={!!plan && block.playlists.length <= plan.itemCount}>See all</a>
			</div>
			<div
				class="bb-body"
				class:tiles={block.kind === 'genre'}
				data-body={block.kind}
				style:height={!formFactor.phone && plan ? `${plan.bodyHeight}px` : undefined}
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
