<script lang="ts">
	import { isRadio } from '../library/queries.ts';
	import { showPanelTab } from '../engine/panel.ts';
	import { currentTrack, playerQueue, totalDuration } from '../player/player.svelte.ts';
	import * as queue from '../player/queue.ts';
	import { COVER_PX, LYRICS, PANEL, QUEUE } from '../tuning.ts';
	import Cover from './Cover.svelte';
	import { formatCount, longDuration } from './format.ts';
	import LikeButton from './LikeButton.svelte';
	import LyricsLines from './LyricsLines.svelte';
	import QueueRow from './QueueRow.svelte';
	import { beginPress, endPress, followPointer } from './queueDrag.ts';
	import { clearQueued } from './queueActions.ts';
	import { toggleFullScreen, togglePanel } from './shell.ts';
	import { formFactor } from './formFactor.svelte.ts';
	import Icon from './Icon.svelte';
	import { ui } from './state.svelte.ts';
	import { swipeToDismiss } from './swipeToDismiss.ts';
	import TrackLinks from './TrackLinks.svelte';

	const track = $derived(currentTrack());
	const sourceRows = $derived(
		playerQueue().sourceQueue.slice(playerQueue().sourceIndex + 1, playerQueue().sourceIndex + 1 + QUEUE.visibleRowCap)
	);
	const sourceRemaining = $derived(Math.max(0, playerQueue().sourceQueue.length - playerQueue().sourceIndex - 1));
	const queuedRows = $derived(playerQueue().userQueue.slice(0, QUEUE.visibleRowCap));
	const total = $derived(queue.upNextCount(playerQueue()));
	const hiddenCount = $derived(sourceRemaining - sourceRows.length);
	const remainingDuration = $derived(hiddenCount > 0 ? totalDuration(playerQueue().sourceQueue.slice(playerQueue().sourceIndex + 1)) : 0);

	let tabs = $state<HTMLElement | null>(null);
	let ink = $state('');

	$effect(() => {
		void ui.panelTab;
		void ui.panelOpen;
		void total;
		const frame = requestAnimationFrame(() => {
			const active = tabs?.querySelector<HTMLElement>(`[data-tab="${ui.panelTab}"]`);
			if (active?.offsetWidth) ink = `translateX(${active.offsetLeft}px) scaleX(${active.offsetWidth / PANEL.tabInkBaseWidthPx})`;
		});
		return () => cancelAnimationFrame(frame);
	});
</script>

<aside
	id="panel"
	aria-label="Now playing and queue"
	{@attach formFactor.phone && swipeToDismiss(() => togglePanel(false), '.pn-head, .pn-now')}
>
	<header class="pn-head">
		<span class="eyebrow">{playerQueue().sourceName ? `Playing from ${playerQueue().sourceName}` : 'Now playing'}</span
		>{#if formFactor.phone}<button class="icon-btn pn-close" type="button" aria-label="Close" onclick={() => togglePanel(false)}
				><Icon name="down" /></button
			>{/if}
	</header>
	<div class="pn-now">
		<button class="pn-art" type="button" aria-label="Open full screen" onclick={toggleFullScreen}
			><Cover albumId={track?.albumId} icon={isRadio(track?.id) ? 'radio' : undefined} size={COVER_PX.panel} eager /></button
		>
		<div class="pn-meta">
			<p class="pn-title">{track?.title ?? ''}</p>
			<p class="pn-sub">
				{#if track}<TrackLinks {track} />{/if}
			</p>
		</div>
		<LikeButton className="pn-like" />
	</div>
	<div class="pn-tabs" role="tablist" bind:this={tabs}>
		<button type="button" role="tab" data-tab="queue" class:on={ui.panelTab === 'queue'} onclick={() => showPanelTab('queue')}
			>Up next <em>{total ? (total > QUEUE.countDisplayCap ? `${QUEUE.countDisplayCap}+` : formatCount(total)) : ''}</em></button
		>
		<button type="button" role="tab" data-tab="lyrics" class:on={ui.panelTab === 'lyrics'} onclick={() => showPanelTab('lyrics')}
			>Lyrics</button
		>
		<span class="tab-ink" style:transform={ink}></span>
	</div>
	<div class="pn-body">
		<div class="pn-pane q-scroll" id="qPane" class:off={ui.panelTab !== 'queue'}>
			{#if queuedRows.length}
				<div id="qUserBlock">
					<p class="eyebrow q-head-row">Queued by you <button type="button" onclick={clearQueued}>Clear</button></p>
					<ol
						class="qlist"
						id="qUser"
						data-kind="user"
						onpointerdown={beginPress}
						onpointermove={followPointer}
						onpointerup={endPress}
						onpointercancel={endPress}
					>
						{#each queuedRows as entry, index (entry.entryId)}<QueueRow {entry} queuedIndex={index} />{/each}
					</ol>
				</div>
			{/if}
			{#if sourceRows.length}<p class="eyebrow q-head-row" id="qSourceHead">
					Next from <span>{playerQueue().sourceName || 'this list'}</span>
				</p>{/if}
			<ol
				class="qlist"
				id="qList"
				data-kind="source"
				onpointerdown={beginPress}
				onpointermove={followPointer}
				onpointerup={endPress}
				onpointercancel={endPress}
			>
				{#each sourceRows as entry, index (entry.entryId)}<QueueRow {entry} sourceIndex={playerQueue().sourceIndex + 1 + index} />{/each}
			</ol>
			{#if !sourceRows.length && !queuedRows.length}<p class="q-empty">Nothing up next. Right-click any track to add it.</p>{/if}
			{#if hiddenCount > 0}<p class="q-more">and {formatCount(hiddenCount)} more · {longDuration(remainingDuration)} in total</p>{/if}
			<p class="q-hint">Drag to reorder · right-click a track for Play next or Add to queue</p>
		</div>
		<LyricsLines
			outerClass="pn-pane pn-lyrics{ui.panelTab === 'lyrics' ? '' : ' off'}"
			innerClass="pn-lines"
			outerId="pnLyrics"
			focusRatio={LYRICS.focusLineRatio.panel}
			visible={ui.panelOpen && !ui.fullScreen && ui.panelTab === 'lyrics'}
		/>
	</div>
</aside>
