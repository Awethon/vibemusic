<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { library } from '../library/library.svelte.ts';
	import { toggleSidebar, ui } from './state.svelte.ts';

	const section = $derived.by(() => {
		const route = page.route.id ?? '/';
		if (route.startsWith('/artist')) return 'artists';
		if (route.startsWith('/playlist')) return 'playlists';
		return 'home';
	});
</script>

<nav class="sidebar" class:open={ui.sidebarOpen}>
	<button class="brand" onclick={toggleSidebar} title={ui.sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}>{ui.sidebarOpen ? 'vibemusic' : 'vm'}</button>
	<a href={resolve('/')} class:active={section === 'home'}><span class="icon">⌂</span><span class="label">Your Music</span></a>
	<a href={resolve('/artists')} class:active={section === 'artists'}><span class="icon">☺</span><span class="label">Artists</span></a>
	<a href={resolve('/playlists')} class:active={section === 'playlists'}><span class="icon">≡</span><span class="label">Playlists</span></a>
	<button onclick={() => (ui.searchOpen = true)}><span class="icon">⌕</span><span class="label">Search <kbd>⌘K</kbd></span></button>
	<span class="spacer"></span>
	{#if library.status === 'syncing'}<span class="status">Syncing…</span>{/if}
	<button onclick={() => (ui.settingsOpen = !ui.settingsOpen)}><span class="icon">⚙</span><span class="label">Settings</span></button>
</nav>
