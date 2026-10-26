<script lang="ts">
	import * as queue from '../player/queue.ts';
	import { editQueue, player, playQueuedAt, playSourceNow } from '../player/player.svelte.ts';
	import { QUEUE } from '../tuning.ts';
	import { clearQueuedWithToast, queuedRowMenu, sourceRowMenu } from './actions.ts';
	import Cover from './Cover.svelte';
	import { clock, longDuration } from './format.ts';
	import { openMenu } from './menu.svelte.ts';
	import { showToast } from './state.svelte.ts';

	let { limit = QUEUE.visibleRowCap, combined = false }: { limit?: number; combined?: boolean } = $props();

	type Row = { entry: queue.Entry; fromUserQueue: boolean; position: number };

	const queued = $derived(player.queue.userQueue.map((entry, position): Row => ({ entry, fromUserQueue: true, position })));
	const upcoming = $derived(queue.upcomingSource(player.queue).map((entry, position): Row => ({ entry, fromUserQueue: false, position })));
	const combinedRows = $derived([...queued, ...upcoming].slice(0, limit));

	let dragged = $state<Row | null>(null);

	function play(row: Row) {
		if (row.fromUserQueue) playQueuedAt(row.position);
		else playSourceNow(player.queue.sourceIndex + 1 + row.position);
	}

	function menuFor(row: Row) {
		return row.fromUserQueue ? queuedRowMenu(row.position) : sourceRowMenu(player.queue.sourceIndex + 1 + row.position);
	}

	function drop(target: Row) {
		const source = dragged;
		dragged = null;
		if (!source || source.fromUserQueue !== target.fromUserQueue || source.position === target.position) return;
		editQueue((state) => queue.reorderUpNext(state, source.fromUserQueue, source.position, target.position));
		showToast('Queue reordered');
	}

	const remaining = (rows: Row[]) => rows.slice(limit);
	const remainingDuration = (rows: Row[]) => remaining(rows).reduce((total, row) => total + (player.tracks[row.entry.trackId]?.duration ?? 0), 0);
</script>

{#snippet row(item: Row)}
	{@const track = player.tracks[item.entry.trackId]}
	<div
		class="queue-row"
		class:dragging={dragged?.entry.entryId === item.entry.entryId}
		data-entry={item.entry.entryId}
		draggable={!combined}
		role="button"
		tabindex="0"
		onclick={() => play(item)}
		onkeydown={(event) => event.key === 'Enter' && play(item)}
		oncontextmenu={(event) => openMenu(event, menuFor(item))}
		ondragstart={() => (dragged = item)}
		ondragend={() => (dragged = null)}
		ondragover={(event) => dragged?.fromUserQueue === item.fromUserQueue && event.preventDefault()}
		ondrop={() => drop(item)}
	>
		<Cover albumId={track?.albumId} size={80} />
		<span class="titles"><span class="title selectable">{track?.title ?? '…'}</span><span class="artist selectable">{track?.artist ?? ''}</span></span>
		<span class="duration">{clock(track?.duration ?? 0)}</span>
	</div>
{/snippet}

{#snippet more(rows: Row[])}
	{#if rows.length > limit}<p class="meta">and {remaining(rows).length} more · {longDuration(remainingDuration(rows))}</p>{/if}
{/snippet}

{#if combined}
	<div class="queue-list">
		{#each combinedRows as item (item.entry.entryId)}{@render row(item)}{/each}
	</div>
{:else if !queued.length && !upcoming.length}
	<p class="empty-state">Nothing up next. Right-click any track to add it.</p>
{:else}
	{#if queued.length}
		<h3>Queued by you <button class="link" onclick={clearQueuedWithToast}>Clear</button></h3>
		<div class="queue-list">
			{#each queued.slice(0, limit) as item (item.entry.entryId)}{@render row(item)}{/each}
		</div>
		{@render more(queued)}
	{/if}
	{#if upcoming.length}
		<h3>Next from {player.queue.sourceName || 'queue'}</h3>
		<div class="queue-list">
			{#each upcoming.slice(0, limit) as item (item.entry.entryId)}{@render row(item)}{/each}
		</div>
		{@render more(upcoming)}
	{/if}
{/if}
