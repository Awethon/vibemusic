<script lang="ts">
	import { viewEnter } from '#lib/ui/viewEnter.ts';
	import { setBodyClass } from '#lib/engine/dom.ts';
	import { resolve } from '$app/paths';
	import { laneSpan, laneYears, layoutTimeline, markedBuckets, timelineLanes } from '#lib/engine/timeline.ts';
	import { albumById, paletteLeads, timelineAlbums } from '#lib/library/queries.ts';
	import { COVER_PX, TIMELINE } from '#lib/tuning.ts';
	import { albumMenu, openAlbum } from '#lib/ui/actions.ts';
	import Cover from '#lib/ui/Cover.svelte';
	import { plural } from '#lib/ui/format.ts';
	import { live } from '#lib/ui/live.svelte.ts';
	import { openMenu } from '#lib/ui/menu.svelte.ts';
	import { timelineAvailable } from '#lib/ui/sections.svelte.ts';

	const albums = live(timelineAlbums, []);
	const leads = live(paletteLeads, new Map<string, string>());
	let scroller = $state<HTMLDivElement>();
	let minimap = $state<HTMLCanvasElement>();
	let scrollLeft = $state(0);
	let viewWidth = $state(0);
	let hoveredLane = $state(-1);
	let tip = $state<{ name: string; detail: string; x: number; y: number } | null>(null);

	const lanes = $derived(timelineLanes(albums.value, TIMELINE.minAlbumsForLane, 'Elsewhere'));
	const layout = $derived(
		layoutTimeline(lanes, { cover: TIMELINE.coverPx, gap: TIMELINE.gapPx, pad: TIMELINE.padPx, empty: TIMELINE.emptyYearPx, start: TIMELINE.labelWidthPx + 16, tail: TIMELINE.tailPx })
	);
	const marks = $derived(markedBuckets(layout.buckets, TIMELINE.markRoomPx));
	const byId = $derived(new Map(albums.value.map((album) => [album.id, album])));
	const height = $derived(TIMELINE.headerHeightPx + lanes.length * TIMELINE.laneHeightPx);
	const era = $derived.by(() => {
		const focus = scrollLeft + TIMELINE.labelWidthPx + (viewWidth - TIMELINE.labelWidthPx) * 0.3;
		return layout.buckets.find((bucket) => bucket.x + bucket.width > focus)?.era ?? '';
	});

	function drawMinimap() {
		const canvas = minimap;
		if (!canvas || !layout.width) return;
		const width = canvas.clientWidth;
		const tall = canvas.clientHeight;
		const ratio = devicePixelRatio || 1;
		canvas.width = width * ratio;
		canvas.height = tall * ratio;
		const context = canvas.getContext('2d');
		if (!context) return;
		context.scale(ratio, ratio);
		const row = (tall - 6) / Math.max(1, lanes.length);
		for (const [id, position] of layout.positions) {
			context.fillStyle = leads.value.get(id) ?? 'rgba(255, 255, 255, 0.55)';
			context.globalAlpha = 0.9;
			context.fillRect((position.x / layout.width) * width, 3 + position.lane * row, Math.max(2, (TIMELINE.coverPx / layout.width) * width), Math.max(1.5, row - 1));
		}
	}

	$effect(() => {
		void layout;
		void leads.value;
		drawMinimap();
	});

	$effect(() => {
		if (!timelineAvailable()) return;
		setBodyClass('timeline-view', true);
		return () => setBodyClass('timeline-view', false);
	});

	$effect(() => {
		const element = scroller;
		if (!element) return;
		const observer = new ResizeObserver(() => {
			viewWidth = element.clientWidth;
			drawMinimap();
		});
		observer.observe(element);
		return () => observer.disconnect();
	});

	function onWheel(event: WheelEvent) {
		const element = scroller;
		if (!element || event.ctrlKey) return;
		const fits = element.scrollHeight <= element.clientHeight + 1;
		if (!fits || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
		event.preventDefault();
		element.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 36 : 1);
	}

	let drag: { x: number; y: number; left: number; top: number; moved: boolean; pointer: number } | null = null;
	let suppressClick = false;

	function onPointerDown(event: PointerEvent) {
		if (event.button !== 0 || event.pointerType === 'touch' || !scroller) return;
		drag = { x: event.clientX, y: event.clientY, left: scroller.scrollLeft, top: scroller.scrollTop, moved: false, pointer: event.pointerId };
	}

	function onPointerMove(event: PointerEvent) {
		if (!drag || !scroller) return;
		const dx = event.clientX - drag.x;
		const dy = event.clientY - drag.y;
		if (!drag.moved && Math.hypot(dx, dy) > TIMELINE.dragThresholdPx) {
			drag.moved = true;
			scroller.setPointerCapture(drag.pointer);
			tip = null;
		}
		if (!drag.moved) return;
		scroller.scrollLeft = drag.left - dx;
		scroller.scrollTop = drag.top - dy;
	}

	function onPointerUp() {
		if (drag?.moved) {
			suppressClick = true;
			setTimeout(() => (suppressClick = false), 0);
		}
		drag = null;
	}

	function open(id: string) {
		if (!suppressClick) void openAlbum(id);
	}

	function showTip(id: string, target: HTMLElement) {
		const album = byId.get(id);
		if (!album || drag?.moved) return;
		const box = target.getBoundingClientRect();
		tip = { name: album.name, detail: `${album.artist}${album.year ? ` · ${album.year}` : ''}`, x: box.left + box.width / 2, y: box.bottom + 8 };
	}

	function seekMinimap(event: PointerEvent) {
		if (!minimap || !scroller) return;
		const box = minimap.getBoundingClientRect();
		scroller.scrollLeft = ((event.clientX - box.left) / box.width) * layout.width - scroller.clientWidth / 2;
	}

	async function menuFor(event: MouseEvent, id: string) {
		tip = null;
		const album = await albumById(id);
		if (album) openMenu(event, albumMenu(album));
	}
</script>

{#if timelineAvailable()}
<section class="view tl-view" {@attach viewEnter}>
	<h1 class="display tl-title">Timeline</h1>
	<div class="tl">
		<div
			class="tl-scroll"
			bind:this={scroller}
			onscroll={() => {
				scrollLeft = scroller?.scrollLeft ?? 0;
				tip = null;
			}}
			onwheel={onWheel}
			onpointerdown={onPointerDown}
			onpointermove={onPointerMove}
			onpointerup={onPointerUp}
			onpointercancel={onPointerUp}
			role="presentation"
		>
			<div class="tl-canvas" style:width="{layout.width}px" style:height="{height}px" style:--lw="{TIMELINE.labelWidthPx}px" style:--cv="{TIMELINE.coverPx}px" style:--lh="{TIMELINE.laneHeightPx}px" style:--hh="{TIMELINE.headerHeightPx}px">
				<div class="tl-grid" aria-hidden="true">
					{#each marks as bucket (bucket.key)}<i class:major={bucket.count > 0} style:left="{bucket.x}px"></i>{/each}
				</div>
				<div class="tl-head">
					<div class="tl-corner"></div>
					{#each marks as bucket (bucket.key)}
						<div class="tl-mark" class:major={bucket.count > 0} style:left="{bucket.x}px">
							<b>{bucket.label}</b>{#if bucket.count}<span>{plural(bucket.count, 'album')}</span>{/if}
						</div>
					{/each}
				</div>
				{#each lanes as lane, index (lane.artistId ?? 'elsewhere')}
					{@const span = laneSpan(lane, layout, TIMELINE.coverPx)}
					<div class="tl-lane" class:dim={hoveredLane >= 0 && hoveredLane !== index} class:hi={hoveredLane === index}>
						{#if span}<i class="tl-line" style:left="{span.from}px" style:width="{span.to - span.from}px"></i>{/if}
						{#if lane.artistId}
							<a class="tl-label" href={resolve('/artist/[id]', { id: lane.artistId })} onpointerenter={() => (hoveredLane = index)} onpointerleave={() => (hoveredLane = -1)}>
								<b>{lane.label}</b><span>{plural(lane.albums.length, 'album')}{laneYears(lane) ? ` · ${laneYears(lane)}` : ''}</span>
							</a>
						{:else}
							<div class="tl-label plain" role="presentation" onpointerenter={() => (hoveredLane = index)} onpointerleave={() => (hoveredLane = -1)}>
								<b>{lane.label}</b><span>{plural(lane.albums.length, 'album')}</span>
							</div>
						{/if}
						{#each lane.albums as album (album.id)}
							{@const position = layout.positions.get(album.id)}
							{#if position}
								<button
									class="tl-item"
									type="button"
									style:left="{position.x}px"
									data-preview-album={album.id}
									aria-label="{album.name} · {album.artist}"
									onclick={() => open(album.id)}
									oncontextmenu={(event) => void menuFor(event, album.id)}
									onpointerenter={(event) => showTip(album.id, event.currentTarget)}
									onpointerleave={() => (tip = null)}><Cover albumId={album.id} size={COVER_PX.card} /></button
								>
							{/if}
						{/each}
					</div>
				{/each}
			</div>
		</div>
		{#if era}<span class="tl-era" aria-hidden="true">{era}</span>{/if}
		<div class="tl-mini" role="presentation" onpointerdown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); seekMinimap(event); }} onpointermove={(event) => event.buttons && seekMinimap(event)}>
			<canvas bind:this={minimap}></canvas>
			{#if layout.width}<i class="tl-window" style:left="{(scrollLeft / layout.width) * 100}%" style:width="{Math.min(100, (viewWidth / layout.width) * 100)}%"></i>{/if}
		</div>
	</div>
	{#if tip}<div class="tl-tip" style:left="{tip.x}px" style:top="{tip.y}px"><b>{tip.name}</b><span>{tip.detail}</span></div>{/if}
</section>
{:else}
	<section class="view" {@attach viewEnter}>
		<h1 class="display tl-title">Timeline</h1>
		<p class="sub">The timeline needs a wider screen. Turn your phone sideways to see it.</p>
	</section>
{/if}
