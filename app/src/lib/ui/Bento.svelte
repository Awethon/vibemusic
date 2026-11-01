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
	type Plan = { columns: number; rows: number; tileSize: number; rowHeight: number; itemCount: number; bodyHeight: number };
	type Geometry = { kind: PlaylistKind; width: number; chrome: number; count: number };
	type Layout = { plans: Record<string, Plan>; aligned: boolean };

	let { blocks }: { blocks: Block[] } = $props();

	let bento = $state<HTMLElement | null>(null);
	let plans = $state<Record<string, Plan>>({});
	let aligned = $state(false);

	const columnCount = $derived(Math.min(blocks.length, 2));
	const solo = $derived(!formFactor.phone && blocks.length === 1);
	const tileGap = () => (solo ? BENTO.soloTileGapPx : BENTO.genreTileGapPx);

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
			const gap = tileGap();
			const maxTiles = BENTO.genreMaxColumns * BENTO.genreMaxRows;
			const columns = Math.max(1, Math.min(solo ? maxTiles : BENTO.genreMaxColumns, Math.floor((item.width + gap) / (Math.min(room, solo ? BENTO.soloTileMinPx : BENTO.genreTileMinPx) + gap))));
			const tileSize = Math.floor(Math.min(room, (item.width - gap * (columns - 1)) / columns));
			const rows = Math.max(1, Math.min(BENTO.genreMaxRows, solo ? Infinity : Math.floor(maxTiles / columns), Math.floor((room + gap) / (tileSize + gap)), Math.ceil(item.count / columns)));
			return { columns, rows, tileSize, rowHeight: tileSize, itemCount: columns * rows, bodyHeight: rows * tileSize + (rows - 1) * gap };
		}
		const maxItems = BENTO.listMaxColumns * BENTO.listMaxRows;
		const columns = Math.max(1, Math.min(solo ? BENTO.soloListMaxColumns : BENTO.listMaxColumns, Math.floor((item.width + BENTO.rowColumnGapPx) / (BENTO.rowMinWidthPx + BENTO.rowColumnGapPx))));
		const rows = Math.max(1, Math.min(BENTO.listMaxRows, Math.floor(maxItems / columns), Math.floor((room + BENTO.rowGapPx) / (BENTO.rowHeightPx + BENTO.rowGapPx)), Math.ceil(item.count / columns)));
		return { columns, rows, tileSize: 0, rowHeight: BENTO.rowHeightPx, itemCount: columns * rows, bodyHeight: rows * BENTO.rowHeightPx + (rows - 1) * BENTO.rowGapPx };
	}

	function stackedRoom(stack: Geometry[], height: number, gap: number) {
		const room = height - gap * (stack.length - 1) - stack.reduce((sum, item) => sum + item.chrome, 0);
		const wanted = stack.map((item) => planFor(item, Infinity).bodyHeight);
		const share = room / stack.length;
		const spare = wanted.reduce((sum, need) => sum + Math.max(0, share - need), 0);
		const short = wanted.filter((need) => need > share).length;
		return wanted.map((need) => (need <= share ? need : share + spare / Math.max(1, short)));
	}

	function planSide(side: Geometry[], height: number, gap: number): [PlaylistKind, Plan][] {
		const rooms = stackedRoom(side, height, gap);
		const planned = side.map((item, index): [PlaylistKind, Plan] => [item.kind, planFor(item, rooms[index])]);
		for (;;) {
			const leftover = height - sideHeight(side, planned, gap);
			const grown = side
				.map((item, index) => ({ index, plan: planFor(item, planned[index][1].bodyHeight + rowStep(item, planned[index][1])) }))
				.filter(({ index, plan }) => plan.rows > planned[index][1].rows && plan.bodyHeight - planned[index][1].bodyHeight <= leftover)
				.toSorted((a, b) => a.plan.bodyHeight - planned[a.index][1].bodyHeight - (b.plan.bodyHeight - planned[b.index][1].bodyHeight))[0];
			if (!grown) return planned;
			planned[grown.index] = [side[grown.index].kind, grown.plan];
		}
	}

	const rowStep = (item: Geometry, plan: Plan) => (item.kind === 'genre' ? plan.tileSize + tileGap() : BENTO.rowHeightPx + BENTO.rowGapPx);

	const sideHeight = (side: Geometry[], planned: [PlaylistKind, Plan][], gap: number) => side.reduce((sum, item, index) => sum + item.chrome + planned[index][1].bodyHeight, 0) + gap * (side.length - 1);

	function grownPlan(item: Geometry, plan: Plan, extra: number): Plan {
		if (extra < 1) return plan;
		if (item.kind === 'genre') {
			const gap = tileGap();
			const widest = Math.floor((item.width - gap * (plan.columns - 1)) / plan.columns);
			const tileSize = Math.max(plan.tileSize, Math.min(widest, Math.floor(plan.tileSize * BENTO.growMaxRatio), plan.tileSize + Math.floor(extra / plan.rows)));
			return { ...plan, tileSize, rowHeight: tileSize, bodyHeight: plan.rows * tileSize + (plan.rows - 1) * gap };
		}
		const rowHeight = Math.min(Math.floor(BENTO.rowHeightPx * BENTO.growMaxRatio), plan.rowHeight + Math.floor(extra / plan.rows));
		return { ...plan, rowHeight, bodyHeight: plan.rows * rowHeight + (plan.rows - 1) * BENTO.rowGapPx };
	}

	function growSide(side: Geometry[], planned: [PlaylistKind, Plan][], target: number, gap: number): [PlaylistKind, Plan][] {
		let slack = target - sideHeight(side, planned, gap);
		return planned.map(([kind, plan], index) => {
			const grown = grownPlan(side[index], plan, slack / (side.length - index));
			slack -= grown.bodyHeight - plan.bodyHeight;
			return [kind, grown];
		});
	}

	const showsEverything = (side: Geometry[], planned: [PlaylistKind, Plan][]) => side.every((item, index) => planned[index][1].itemCount >= item.count);

	function fittedLayout(): Layout {
		const height = fillHeight();
		const gap = bento ? parseFloat(getComputedStyle(bento).rowGap) || 0 : 0;
		const [lead, ...rest] = measureGeometry();
		if (!lead) return { plans: {}, aligned: false };
		let left = planSide([lead], height, gap);
		let right = planSide(rest, height, gap);
		let aligned = false;
		if (rest.length) {
			const leftHeight = sideHeight([lead], left, gap);
			const rightHeight = sideHeight(rest, right, gap);
			const leftShorter = leftHeight < rightHeight;
			const close = Math.abs(leftHeight - rightHeight) <= BENTO.alignWithinPx;
			const shorterHasMore = !(leftShorter ? showsEverything([lead], left) : showsEverything(rest, right));
			aligned = close || shorterHasMore;
			if (aligned && !close) {
				if (leftShorter) right = planSide(rest, leftHeight, gap);
				else left = planSide([lead], rightHeight, gap);
			}
			if (aligned) {
				const target = Math.max(sideHeight([lead], left, gap), sideHeight(rest, right, gap));
				left = growSide([lead], left, target, gap);
				right = growSide(rest, right, target, gap);
			}
		}
		return { plans: Object.fromEntries([...left, ...right]), aligned };
	}

	const signature = (all: Record<string, Plan>) => Object.entries(all).map(([kind, plan]) => `${kind}:${plan.itemCount}|${plan.columns}|${plan.tileSize}|${plan.rowHeight}|${plan.bodyHeight}`).join(',');

	function stackedPlans(): Record<string, Plan> {
		return Object.fromEntries(
			blocks.map((block) => [
				block.kind,
				block.kind === 'genre'
					? { columns: BENTO.phoneGenreColumns, rows: BENTO.phoneGenreRows, tileSize: 0, rowHeight: 0, itemCount: BENTO.phoneGenreColumns * BENTO.phoneGenreRows, bodyHeight: 0 }
					: { columns: 1, rows: BENTO.phoneListRows, tileSize: 0, rowHeight: BENTO.rowHeightPx, itemCount: BENTO.phoneListRows, bodyHeight: 0 }
			])
		);
	}

	const currentLayout = (): Layout => (formFactor.phone ? { plans: stackedPlans(), aligned: false } : fittedLayout());

	function refit() {
		const next = currentLayout();
		if (signature(next.plans) !== signature(plans)) plans = next.plans;
		aligned = next.aligned;
	}

	$effect(() => {
		void blocks;
		void bento;
		void formFactor.phone;
		untrack(refit);
		const frame = requestAnimationFrame(refit);
		const unregister = registerLayout({
			needsRefill: () => {
				const next = currentLayout();
				return next.aligned !== aligned || signature(next.plans) !== signature(plans);
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

<div class="bento" class:stacked={formFactor.phone} class:solo id="bento" bind:this={bento} style:grid-template-columns={formFactor.phone ? undefined : `repeat(${columnCount}, minmax(0, 1fr))`} style:grid-template-rows={!formFactor.phone && blocks.length > 2 ? 'auto 1fr' : undefined} style:align-items={aligned ? 'stretch' : 'start'}>
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
				style:gap={solo && block.kind === 'genre' ? `${BENTO.soloTileGapPx}px` : undefined}
				data-body={block.kind}
				style:height={!formFactor.phone && plan ? `${plan.bodyHeight}px` : undefined}
				style:grid-template-columns={plan ? (plan.tileSize ? `repeat(${plan.columns}, ${plan.tileSize}px)` : `repeat(${plan.columns}, minmax(0, 1fr))`) : undefined}
				style:grid-auto-rows={plan ? (block.kind !== 'genre' ? `${plan.rowHeight}px` : plan.tileSize ? `${plan.tileSize}px` : 'auto') : undefined}
				style:--row-h={plan && block.kind !== 'genre' ? `${plan.rowHeight}px` : undefined}
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
