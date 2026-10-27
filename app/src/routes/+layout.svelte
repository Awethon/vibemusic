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
	import { setBodyClass } from '#lib/engine/dom.ts';
	import { library } from '#lib/library/library.svelte.ts';
	import { loadLyricsFor } from '#lib/player/lyricsState.svelte.ts';
	import { currentTrack, player } from '#lib/player/player.svelte.ts';
	import { session } from '#lib/session.svelte.ts';
	import { installShell, libraryReady, startServices } from '#lib/startup.ts';
	import AlphabetNav from '#lib/ui/AlphabetNav.svelte';
	import Ambient from '#lib/ui/Ambient.svelte';
	import Background from '#lib/ui/Background.svelte';
	import Capsule from '#lib/ui/Capsule.svelte';
	import ConnectionNote from '#lib/ui/ConnectionNote.svelte';
	import ContextMenu from '#lib/ui/ContextMenu.svelte';
	import DevicesPopover from '#lib/ui/DevicesPopover.svelte';
	import FilterPopover from '#lib/ui/FilterPopover.svelte';
	import GlassLayer from '#lib/ui/GlassLayer.svelte';
	import LibraryGate from '#lib/ui/LibraryGate.svelte';
	import Login from '#lib/ui/Login.svelte';
	import { showView } from '#lib/ui/navigation.ts';
	import NowCanvas from '#lib/ui/NowCanvas.svelte';
	import NowClassic from '#lib/ui/NowClassic.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import { installPalettePreview } from '#lib/ui/palettePreview.ts';
	import Rail from '#lib/ui/Rail.svelte';
	import RemoteBanner from '#lib/ui/RemoteBanner.svelte';
	import SearchPalette from '#lib/ui/SearchPalette.svelte';
	import { restoreMainScroll } from '#lib/ui/scrollRestore.ts';
	import SettingsPopover from '#lib/ui/SettingsPopover.svelte';
	import Toast from '#lib/ui/Toast.svelte';
	import type { LayoutProps, Snapshot } from './$types';

	let { children }: LayoutProps = $props();
	let main = $state<HTMLElement | null>(null);
	let started = false;
	let ready = false;
	const signedIn = $derived(!!session.credentials && !session.expired);

	export const snapshot: Snapshot<number> = {
		capture: () => main?.scrollTop ?? 0,
		restore: (scrollTop) => restoreMainScroll(scrollTop)
	};

	$effect(() => {
		if (!signedIn || started) return;
		started = true;
		startServices();
	});

	$effect(() => {
		if (signedIn) return untrack(installShell);
	});

	$effect(() => {
		if (library.status !== 'ready' || ready) return;
		ready = true;
		libraryReady();
	});

	$effect(() => {
		setBodyClass('is-playing', player.playing);
	});

	$effect(() => {
		const trackId = currentTrack()?.id ?? '';
		untrack(() => loadLyricsFor(trackId));
	});

	$effect(() => {
		if (main) return installPalettePreview(main);
	});

	afterNavigate(({ type }) => {
		showView(page.route.id, page.params);
		if (type !== 'popstate') main?.scrollTo({ top: 0 });
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>{currentTrack() ? `${currentTrack()?.title} · ${currentTrack()?.artist}` : 'vibemusic'}</title>
</svelte:head>

<Background />
<GlassLayer level="rail" />
{#if !signedIn}
	<Login />
{:else}
	<div id="chrome">
		<Rail />
		<main id="main" tabindex="-1" bind:this={main}>
			<LibraryGate>{@render children()}</LibraryGate>
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
	<RemoteBanner />
	<ConnectionNote />
	<Toast />
{/if}
