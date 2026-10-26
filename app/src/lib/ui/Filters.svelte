<script lang="ts">
	import Icon from './Icon.svelte';
	import { clearFilters, filtering, ui, type FilterKind } from './state.svelte.ts';

	function toggle(kind: FilterKind, event: MouseEvent) {
		event.stopPropagation();
		if (ui.filterPopover?.kind === kind) {
			ui.filterPopover = null;
			return;
		}
		ui.filterPopover = { kind };
	}
</script>

<div class="filters">
	<button class="fbtn" data-filter="genre" class:on={!!ui.filters.genres.length} type="button" onclick={(event) => toggle('genre', event)}>{ui.filters.genres[0] ?? 'All genres'}<Icon name="down" /></button>
	<button class="fbtn" data-filter="decade" class:on={!!ui.filters.decades.length} type="button" onclick={(event) => toggle('decade', event)}>{ui.filters.decades.length ? `${ui.filters.decades[0]}s` : 'All years'}<Icon name="down" /></button>
	{#if filtering()}<button class="fclear" type="button" onclick={clearFilters}>Clear</button>{/if}
</div>
