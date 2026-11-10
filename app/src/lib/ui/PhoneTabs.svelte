<script lang="ts">
	import { page } from '$app/state';
	import { radioStations } from '../library/queries.ts';
	import { session } from '../session.svelte.ts';
	import Icon from './Icon.svelte';
	import { live } from './live.svelte.ts';
	import { sectionFor, visibleSections } from './sections.svelte.ts';
	import { ui } from './state.svelte.ts';

	const section = $derived(sectionFor(page.route.id));
	const stations = live(radioStations, [], []);
</script>

<nav id="tabs" aria-label="Sections">
	{#each visibleSections(!!(stations.value.length || session.credentials?.isAdmin)) as item (item.id)}
		<a class="tab" class:active={section === item.id} href={item.href} aria-current={section === item.id ? 'page' : undefined}
			><Icon name={item.icon} /><span>{item.shortLabel}</span></a
		>
	{/each}
	<button class="tab" type="button" class:active={ui.searchOpen} onclick={() => (ui.searchOpen = true)}
		><Icon name="search" /><span>Search</span></button
	>
	<button
		class="tab"
		id="bSettings"
		type="button"
		class:active={ui.settingsOpen}
		onclick={(event) => {
			event.stopPropagation();
			ui.settingsOpen = !ui.settingsOpen;
		}}><Icon name="gear" /><span>Settings</span></button
	>
</nav>
