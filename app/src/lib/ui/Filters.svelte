<script lang="ts">
	import { decadeCounts, genreCounts } from '../library/queries.ts';
	import { live } from './live.svelte.ts';
	import { clearFilters, filtering, ui } from './state.svelte.ts';

	const genres = live(genreCounts, []);
	const decades = live(decadeCounts, []);

	function toggle<T>(list: T[], value: T): T[] {
		return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
	}
</script>

<div class="filters">
	<details>
		<summary>Genre{ui.filters.genres.length ? ` (${ui.filters.genres.length})` : ''}</summary>
		<div class="options">
			{#each genres.value as { genre, albums } (genre)}
				<label><input type="checkbox" checked={ui.filters.genres.includes(genre)} onchange={() => (ui.filters.genres = toggle(ui.filters.genres, genre))} /> {genre} <small>{albums}</small></label>
			{/each}
		</div>
	</details>
	<details>
		<summary>Decade{ui.filters.decades.length ? ` (${ui.filters.decades.length})` : ''}</summary>
		<div class="options">
			{#each decades.value as { decade, albums } (decade)}
				<label><input type="checkbox" checked={ui.filters.decades.includes(decade)} onchange={() => (ui.filters.decades = toggle(ui.filters.decades, decade))} /> {decade}s <small>{albums}</small></label>
			{/each}
		</div>
	</details>
	{#if filtering()}<button class="link" onclick={clearFilters}>Clear</button>{/if}
</div>
