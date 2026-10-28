<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { toggleRail } from '../engine/rail.ts';
	import { library } from '../library/library.svelte.ts';
	import { radioStations } from '../library/queries.ts';
	import { session } from '../session.svelte.ts';
	import { live } from './live.svelte.ts';
	import Icon from './Icon.svelte';
	import { ui } from './state.svelte.ts';

	const section = $derived.by(() => {
		const route = page.route.id ?? '/';
		if (route.startsWith('/artist')) return 'artists';
		if (route.startsWith('/playlist')) return 'playlists';
		if (route.startsWith('/timeline')) return 'timeline';
		if (route.startsWith('/radio')) return 'radio';
		return 'home';
	});
	const stations = live(radioStations, []);
	const foldLabel = $derived(ui.railExpanded ? 'Fold sidebar' : 'Expand sidebar');
</script>

<nav id="rail">
	<a class="brand" href={resolve('/')} aria-label="vibemusic"><span class="b-full">vibe<span>music</span></span><span class="b-mini">v<span>m</span></span></a>
	<button class="nav nav-search" type="button" title="Search (/)" onclick={() => (ui.searchOpen = true)}><span class="ni"><Icon name="search" /></span><span class="nl">Search</span></button>
	<div class="nav-group">
		<a class="nav" class:active={section === 'home'} href={resolve('/')} title="Your Music"><span class="ni"><Icon name="home" /></span><span class="nl">Your Music</span></a>
		<a class="nav" class:active={section === 'artists'} href={resolve('/artists')} title="Artists"><span class="ni"><Icon name="mic" /></span><span class="nl">Artists</span></a>
		<a class="nav" class:active={section === 'playlists'} href={resolve('/playlists')} title="Playlists"><span class="ni"><Icon name="lists" /></span><span class="nl">Playlists</span></a>
		{#if ui.showTimeline}<a class="nav" class:active={section === 'timeline'} href={resolve('/timeline')} title="Timeline"><span class="ni"><Icon name="timeline" /></span><span class="nl">Timeline</span></a>{/if}
		{#if ui.showRadio && (stations.value.length || session.credentials?.isAdmin)}<a class="nav" class:active={section === 'radio'} href={resolve('/radio')} title="Radio"><span class="ni"><Icon name="radio" /></span><span class="nl">Radio</span></a>{/if}
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
		<button class="nav" type="button" title={foldLabel} onclick={toggleRail}><span class="ni"><Icon name={ui.railExpanded ? 'fold' : 'unfold'} /></span><span class="nl">{foldLabel}</span></button>
	</div>
</nav>
