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
	// After app.css on purpose: phone.css overrides the desktop rules for body.phone.
	import '../styles/phone.css';
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
	import { favicon } from '#lib/ui/favicon.svelte.ts';
	import { formFactor } from '#lib/ui/formFactor.svelte.ts';
	import DevicesPopover from '#lib/ui/DevicesPopover.svelte';
	import FilterPopover from '#lib/ui/FilterPopover.svelte';
	import GlassLayer from '#lib/ui/GlassLayer.svelte';
	import LibraryGate from '#lib/ui/LibraryGate.svelte';
	import Login from '#lib/ui/Login.svelte';
	import { showView } from '#lib/ui/navigation.ts';
	import NowClassic from '#lib/ui/NowClassic.svelte';
	import NowPhone from '#lib/ui/NowPhone.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PhoneDock from '#lib/ui/PhoneDock.svelte';
	import PhoneTabs from '#lib/ui/PhoneTabs.svelte';
	import { installPalettePreview } from '#lib/ui/palettePreview.ts';
	import Rail from '#lib/ui/Rail.svelte';
	import RemoteBanner from '#lib/ui/RemoteBanner.svelte';
	import SearchPalette from '#lib/ui/SearchPalette.svelte';
	import { restoreMainScroll } from '#lib/ui/scrollRestore.ts';
	import SettingsPopover from '#lib/ui/SettingsPopover.svelte';
	import ShareLink from '#lib/ui/ShareLink.svelte';
	import Toast from '#lib/ui/Toast.svelte';
	import type { LayoutProps, Snapshot } from './$types';

	let { children }: LayoutProps = $props();
	let main = $state<HTMLElement | null>(null);
	let started = false;
	let ready = false;
	// The share page is public: it renders on its own, without sign-in, services or the app shell.
	const publicPage = page.route.id === '/share/[id]';
	const signedIn = $derived(!publicPage && !!session.credentials && !session.expired);

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
		if (publicPage || library.status !== 'ready' || ready) return;
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

	// #main is the page scroller, not the window, so scroll is handled here: back/forward restores
	// it through the snapshot above, any other navigation starts at the top.
	afterNavigate(({ type }) => {
		showView(page.route.id, page.params);
		if (type !== 'popstate') main?.scrollTo({ top: 0 });
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon.href} />
	<title>{currentTrack() ? `${currentTrack()?.title} · ${currentTrack()?.artist}` : 'vibemusic'}</title>
</svelte:head>

{#if publicPage}
	{@render children()}
{:else}
	<!-- Each GlassLayer canvas sits right under the surfaces it draws glass for. Keep this order in
	     step with the stacking order in styles/shell.css and lib/glass/backdrop.ts. -->
	<Background />
	<GlassLayer level="rail" />
	{#if !signedIn}
		<Login />
	{:else}
		<div id="chrome">
			{#if formFactor.phone}<PhoneTabs />{:else}<Rail />{/if}
			<main id="main" tabindex="-1" bind:this={main}>
				<LibraryGate>{@render children()}</LibraryGate>
			</main>
			{#if !formFactor.phone}<AlphabetNav />{/if}
		</div>
		{#if formFactor.phone}
			<NowPhone />
		{:else}
			<NowClassic />
			<Ambient />
		{/if}
		<GlassLayer level="player" />
		<Panel />
		{#if formFactor.phone}<PhoneDock />{:else}<Capsule />{/if}
		<GlassLayer level="popups" />
		<SettingsPopover />
		<DevicesPopover />
		<FilterPopover />
		<ContextMenu />
		<SearchPalette />
		<RemoteBanner />
		<ConnectionNote />
		<ShareLink />
		<Toast />
	{/if}
{/if}
