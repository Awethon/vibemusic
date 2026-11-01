<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { toggleRail } from '../engine/rail.ts';
	import { library } from '../library/library.svelte.ts';
	import { radioStations } from '../library/queries.ts';
	import { session } from '../session.svelte.ts';
	import { live } from './live.svelte.ts';
	import { sectionFor, visibleSections } from './sections.svelte.ts';
	import Icon from './Icon.svelte';
	import { ui } from './state.svelte.ts';

	const section = $derived(sectionFor(page.route.id));
	const stations = live(radioStations, []);
	const foldLabel = $derived(ui.railExpanded ? 'Fold sidebar' : 'Expand sidebar');
</script>

<nav id="rail">
	<a class="brand" href={resolve('/')} aria-label="vibemusic"
		><span class="b-full">vibe<span>music</span></span><span class="b-mini">v<span>m</span></span></a
	>
	<button class="nav nav-search" type="button" title="Search (/)" onclick={() => (ui.searchOpen = true)}
		><span class="ni"><Icon name="search" /></span><span class="nl">Search</span></button
	>
	<div class="nav-group">
		{#each visibleSections(!!(stations.value.length || session.credentials?.isAdmin)) as item (item.id)}
			<a class="nav" class:active={section === item.id} href={item.href} title={item.label}
				><span class="ni"><Icon name={item.icon} /></span><span class="nl">{item.label}</span></a
			>
		{/each}
	</div>
	<div class="rail-foot">
		{#if library.status === 'syncing'}<span class="nav sync-note"><span class="nl">Syncing library…</span></span>{/if}
		<button
			class="nav"
			id="bSettings"
			type="button"
			title="Settings"
			onclick={(event) => {
				event.stopPropagation();
				ui.filterPopover = null;
				ui.settingsOpen = !ui.settingsOpen;
			}}><span class="ni"><Icon name="gear" /></span><span class="nl">Settings</span></button
		>
		<button class="nav" type="button" title={foldLabel} onclick={toggleRail}
			><span class="ni"><Icon name={ui.railExpanded ? 'fold' : 'unfold'} /></span><span class="nl">{foldLabel}</span></button
		>
	</div>
</nav>
