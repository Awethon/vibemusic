<script lang="ts">
	import { isRadio } from '../library/queries.ts';
	import type { Entry } from '../player/queue.ts';
	import { trackById } from '../player/player.svelte.ts';
	import { queueRowMenu } from './actions.ts';
	import Cover from './Cover.svelte';
	import { clock } from './format.ts';
	import { openMenu } from './menu.svelte.ts';
	import { COVER_PX } from '../tuning.ts';

	let { entry, queuedIndex, sourceIndex }: { entry: Entry; queuedIndex?: number; sourceIndex?: number } = $props();
	const track = $derived(trackById(entry.trackId));
</script>

<li
	class="mini"
	data-uq={queuedIndex}
	data-qi={sourceIndex}
	data-id={entry.trackId}
	data-entry={entry.entryId}
	oncontextmenu={(event) => openMenu(event, queueRowMenu(event.currentTarget as HTMLElement))}
>
	<Cover albumId={track?.albumId} icon={isRadio(track?.id) ? 'radio' : undefined} size={COVER_PX.row} />
	<div><b>{track?.title ?? ''}</b><small>{track?.artist ?? ''} · {clock(track?.duration ?? 0)}</small></div>
</li>
