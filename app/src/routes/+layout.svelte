<script lang="ts">
	import '@fontsource/onest/400.css';
	import '@fontsource/onest/500.css';
	import '@fontsource/onest/600.css';
	import '@fontsource/onest/700.css';
	import '@fontsource/unbounded/300.css';
	import '@fontsource/unbounded/400.css';
	import '@fontsource/unbounded/500.css';
	import '@fontsource/unbounded/700.css';
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import { untrack } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { bodyHasClass, setBodyClass } from '#lib/engine/dom.ts';
	import { installGestureRecognizer } from '#lib/engine/gestures.ts';
	import { installIdleTracking } from '#lib/engine/idle.svelte.ts';
	import { installResizeRelayout } from '#lib/engine/layout.svelte.ts';
	import { isPreviewingPalette, previewPalette, updatePalettePageHold } from '#lib/engine/palette.ts';
	import { setRailExpanded } from '#lib/engine/rail.ts';
	import { history, seedHistory } from '#lib/history.svelte.ts';
	import { library, resyncLibrary, startLibrary } from '#lib/library/library.svelte.ts';
	import { recentlyPlayedAlbums } from '#lib/library/queries.ts';
	import { loadLyricsFor } from '#lib/player/lyricsState.svelte.ts';
	import { currentTrack, player, playNextTrack, playOn, playPreviousTrack, restoreSavedQueue, seekBy, startPlayer, startRemoteControl, togglePlay } from '#lib/player/player.svelte.ts';
	import { deviceLabel } from '#lib/remote/devices.ts';
	import { activeIsOnline, isActiveElsewhere, relay } from '#lib/remote/relay.svelte.ts';
	import DevicesPopover from '#lib/ui/DevicesPopover.svelte';
	import { session } from '#lib/session.svelte.ts';
	import { HISTORY, PLAYBACK } from '#lib/tuning.ts';
	import AlphabetNav from '#lib/ui/AlphabetNav.svelte';
	import Ambient from '#lib/ui/Ambient.svelte';
	import Background from '#lib/ui/Background.svelte';
	import Capsule from '#lib/ui/Capsule.svelte';
	import ConnectionNote from '#lib/ui/ConnectionNote.svelte';
	import { installScreenEdges } from '#lib/ui/screenEdges.ts';
	import { restoreMainScroll } from '#lib/ui/scrollRestore.ts';
	import { installBrokenImageRetry } from '#lib/ui/brokenImages.ts';
	import ContextMenu from '#lib/ui/ContextMenu.svelte';
	import FirstSync from '#lib/ui/FirstSync.svelte';
	import GlassLayer from '#lib/ui/GlassLayer.svelte';
	import { checkConnection, connection, watchConnection } from '#lib/connection.svelte.ts';
	import FilterPopover from '#lib/ui/FilterPopover.svelte';
	import Login from '#lib/ui/Login.svelte';
	import { anyMenuOpen, closeAllMenus } from '#lib/ui/menu.svelte.ts';
	import NowCanvas from '#lib/ui/NowCanvas.svelte';
	import NowClassic from '#lib/ui/NowClassic.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import Rail from '#lib/ui/Rail.svelte';
	import SearchPalette from '#lib/ui/SearchPalette.svelte';
	import SettingsPopover from '#lib/ui/SettingsPopover.svelte';
	import { applyFullScreenStyleClass, setFullScreen, toggleFullScreen, togglePanel, togglePanelTab } from '#lib/ui/shell.ts';
	import { ui } from '#lib/ui/state.svelte.ts';
	import Toast from '#lib/ui/Toast.svelte';
	import type { LayoutProps, Snapshot } from './$types';

	let { children }: LayoutProps = $props();
	let main = $state<HTMLElement | null>(null);

	export const snapshot: Snapshot<number> = {
		capture: () => main?.scrollTop ?? 0,
		restore: (scrollTop) => restoreMainScroll(scrollTop)
	};
	let started = false;
	let restored = false;
	const signedIn = $derived(!!session.credentials && !session.expired);

	$effect(() => {
		if (!signedIn || started) return;
		started = true;
		watchConnection();
		installBrokenImageRetry();
		startPlayer();
		void startLibrary();
	});

	$effect(() => {
		if (!signedIn) return;
		const cleanups = untrack(() => {
			setRailExpanded(ui.railExpanded, true);
			applyFullScreenStyleClass();
			return [installGestureRecognizer(), installIdleTracking(), installResizeRelayout(), installScreenEdges()];
		});
		return () => cleanups.forEach((cleanup) => cleanup());
	});

	$effect(() => {
		if (library.status !== 'ready' || restored) return;
		restored = true;
		void restoreSavedQueue();
		startRemoteControl();
		if (!history.items.length) void recentlyPlayedAlbums(HISTORY.maxLength).then((albums) => seedHistory(albums.map((album) => album.id)));
	});

	$effect(() => {
		setBodyClass('is-playing', player.playing);
	});

	$effect(() => {
		setBodyClass('remote', isActiveElsewhere());
		setBodyClass('tap-to-play', player.waitingForTap && !isActiveElsewhere());
	});

	$effect(() => {
		const trackId = currentTrack()?.id ?? '';
		untrack(() => loadLyricsFor(trackId));
	});

	$effect(() => {
		const element = main;
		if (!element) return;
		const onOver = (event: MouseEvent) => {
			if (ui.view.name === 'album') return;
			const target = (event.target as Element).closest<HTMLElement>('[data-preview-album]');
			if (target?.dataset.previewAlbum) previewPalette(target.dataset.previewAlbum);
			else if (isPreviewingPalette()) previewPalette(null);
		};
		const onLeave = () => previewPalette(null);
		element.addEventListener('mouseover', onOver);
		element.addEventListener('mouseleave', onLeave);
		return () => {
			element.removeEventListener('mouseover', onOver);
			element.removeEventListener('mouseleave', onLeave);
		};
	});

	afterNavigate(({ type }) => {
		const route = page.route.id ?? '/';
		const name = route === '/' ? 'home' : (route.split('/')[1] ?? 'home');
		const id = page.params.id ?? page.params.kind ?? '';
		ui.view = { name, id };
		updatePalettePageHold(name, id);
		closeAllMenus();
		setFullScreen(false);
		if (type !== 'popstate') main?.scrollTo({ top: 0 });
	});

	function handleEscape() {
		if (ui.searchOpen) {
			ui.searchOpen = false;
			previewPalette(null);
			return true;
		}
		if (anyMenuOpen()) {
			closeAllMenus();
			return true;
		}
		if (bodyHasClass('now-open')) {
			setFullScreen(false);
			return true;
		}
		if (bodyHasClass('panel-open')) {
			togglePanel(false);
			return true;
		}
		return false;
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && handleEscape()) return;
		if ((event.target instanceof Element && event.target.matches('input, textarea')) || event.metaKey || event.ctrlKey || ui.searchOpen) return;
		if (event.key === '/') ui.searchOpen = true;
		else if (event.code === 'Space') togglePlay();
		else if (event.shiftKey && event.key === 'ArrowRight') playNextTrack();
		else if (event.shiftKey && event.key === 'ArrowLeft') playPreviousTrack();
		else if (event.altKey && event.key === 'ArrowRight') seekBy(PLAYBACK.seekStepSeconds);
		else if (event.altKey && event.key === 'ArrowLeft') seekBy(-PLAYBACK.seekStepSeconds);
		else if (event.key === 'q') togglePanelTab('queue');
		else if (event.key === 'l') togglePanelTab('lyrics');
		else if (event.key === 'f') toggleFullScreen();
		else return;
		event.preventDefault();
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>{currentTrack() ? `${currentTrack()?.title} · ${currentTrack()?.artist}` : 'vibemusic'}</title>
</svelte:head>

<svelte:window {onkeydown} />

<Background />
<GlassLayer level="rail" />
{#if !signedIn}
	<Login />
{:else}
	<div id="chrome">
		<Rail />
		<main id="main" tabindex="-1" bind:this={main}>
			{#if library.status === 'ready' && library.meta?.tracks === 0}
				<div class="first-run-problem">
					<h1 class="display">Your library is empty</h1>
					<p>Navidrome hasn’t found any music yet. Add albums to its music folder and run a scan in Navidrome — vibemusic picks them up within a minute.</p>
				</div>
			{:else if library.status === 'ready'}
				{@render children()}
			{:else if library.status === 'error'}
				<div class="first-run-problem">
					<h1 class="display">{connection.unreachable ? 'Can’t reach Navidrome' : 'Couldn’t load your library'}</h1>
					<p>{connection.unreachable ? `vibemusic is trying ${new URL(NAVIDROME_TARGET).host} again every few seconds.` : library.error}</p>
					<button class="ghost" type="button" onclick={() => (connection.unreachable ? void checkConnection() : void resyncLibrary())}>Retry</button>
				</div>
			{:else if library.status === 'syncing'}
				<FirstSync />
			{/if}
		</main>
		<AlphabetNav />
	</div>
	<NowCanvas />
	<NowClassic />
	<Ambient />
	<GlassLayer level="player" />
	<Panel />
	<Capsule />
	<GlassLayer level="popups" />
	<SettingsPopover />
	<DevicesPopover />
	<FilterPopover />
	<ContextMenu />
	<SearchPalette />
	<div id="remoteBanner" aria-hidden={!isActiveElsewhere() && !player.waitingForTap}>
		<span class="pulse"></span>
		{#if !isActiveElsewhere()}
			<span>Tap anywhere to start playing here</span>
		{:else}
			<span
				>{#if !activeIsOnline()}<b>{deviceLabel(relay.active)}</b> is offline{:else if player.waitingForTap}Tap the screen on <b>{deviceLabel(relay.active)}</b> to start playing there{:else}Playing on <b>{deviceLabel(relay.active)}</b> · this tab is a remote{/if}</span
			>
			<button type="button" onclick={() => playOn(relay.deviceId)}>Play here</button>
		{/if}
	</div>
	<ConnectionNote />
	<Toast />
{/if}
