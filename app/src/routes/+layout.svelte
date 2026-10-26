<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import { afterNavigate } from '$app/navigation';
	import { library, startLibrary } from '#lib/library/library.svelte.ts';
	import { player, playNextTrack, playPreviousTrack, restoreSavedQueue, seekBy, startPlayer, togglePlay } from '#lib/player/player.svelte.ts';
	import { session } from '#lib/session.svelte.ts';
	import { PLAYBACK } from '#lib/tuning.ts';
	import Background from '#lib/ui/Background.svelte';
	import ContextMenu from '#lib/ui/ContextMenu.svelte';
	import FullScreen from '#lib/ui/FullScreen.svelte';
	import Login from '#lib/ui/Login.svelte';
	import { closeMenu, menu } from '#lib/ui/menu.svelte.ts';
	import Panel from '#lib/ui/Panel.svelte';
	import PlayerBar from '#lib/ui/PlayerBar.svelte';
	import Search from '#lib/ui/Search.svelte';
	import Settings from '#lib/ui/Settings.svelte';
	import Sidebar from '#lib/ui/Sidebar.svelte';
	import { setFullScreen, togglePanel, ui } from '#lib/ui/state.svelte.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
	let main = $state<HTMLElement | null>(null);
	let started = false;
	let restored = false;

	$effect(() => {
		if (!session.credentials || session.expired || started) return;
		started = true;
		startPlayer();
		void startLibrary();
	});

	$effect(() => {
		if (library.status !== 'ready' || restored) return;
		restored = true;
		void restoreSavedQueue();
	});

	afterNavigate(({ type }) => {
		if (type !== 'popstate') main?.scrollTo({ top: 0 });
		closeMenu();
		ui.settingsOpen = false;
		setFullScreen(false);
	});

	function typing(target: EventTarget | null) {
		return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
	}

	function onkeydown(event: KeyboardEvent) {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			ui.searchOpen = !ui.searchOpen;
			return;
		}
		if (event.key === 'Escape') {
			if (ui.searchOpen) ui.searchOpen = false;
			else if (menu.open || ui.settingsOpen) {
				closeMenu();
				ui.settingsOpen = false;
			} else if (ui.fullScreen) setFullScreen(false);
			else if (ui.panelOpen) ui.panelOpen = false;
			return;
		}
		if (typing(event.target) || ui.searchOpen || event.metaKey || event.ctrlKey) return;
		if (event.key === ' ') togglePlay();
		else if (event.shiftKey && event.key === 'ArrowRight') playNextTrack();
		else if (event.shiftKey && event.key === 'ArrowLeft') playPreviousTrack();
		else if (event.altKey && event.key === 'ArrowRight') seekBy(PLAYBACK.seekStepSeconds);
		else if (event.altKey && event.key === 'ArrowLeft') seekBy(-PLAYBACK.seekStepSeconds);
		else if (event.key === 'q') togglePanel('queue');
		else if (event.key === 'l') togglePanel('lyrics');
		else if (event.key === 'f') setFullScreen(!ui.fullScreen);
		else return;
		event.preventDefault();
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>{player.queue.currentTrackId && player.tracks[player.queue.currentTrackId] ? `${player.tracks[player.queue.currentTrackId].title} · vibemusic` : 'vibemusic'}</title>
</svelte:head>

<svelte:window {onkeydown} />

{#if !session.credentials || session.expired}
	<Login />
{:else}
	<Background />
	<div class="app" class:panel-open={ui.panelOpen} class:sidebar-open={ui.sidebarOpen} class:full-screen={ui.fullScreen}>
		<Sidebar />
		<main class="main" bind:this={main}>
			{#if library.status === 'ready'}
				{@render children()}
			{:else if library.status === 'error'}
				<p class="empty-state">Could not load the library: {library.error}</p>
			{:else}
				<p class="empty-state">{library.status === 'syncing' ? 'Syncing your library for the first time…' : 'Loading library…'}</p>
			{/if}
		</main>
		<Panel />
		{#if ui.fullScreen}<FullScreen />{/if}
		<PlayerBar />
		{#if ui.settingsOpen}<Settings />{/if}
		{#if ui.searchOpen && library.status === 'ready'}<Search />{/if}
		<ContextMenu />
		{#if ui.toast}<div class="toast" role="status">{ui.toast}</div>{/if}
	</div>
{/if}
