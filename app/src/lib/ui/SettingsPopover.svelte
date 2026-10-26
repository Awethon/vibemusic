<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { glass, setGlassEnabled } from '../glass/settings.svelte.ts';
	import { library, resyncLibrary } from '../library/library.svelte.ts';
	import { session, signOut } from '../session.svelte.ts';
	import { POPOVER } from '../tuning.ts';
	import { relativeTime } from './format.ts';
	import { applyFullScreenStyleClass } from './shell.ts';
	import { setFullScreenStyle, setRipples, ui, type FullScreenStyle } from './state.svelte.ts';

	const options: [FullScreenStyle, string, string][] = [
		['canvas', 'Canvas', 'Lyrics centre stage'],
		['classic', 'Classic', 'Large cover beside lyrics'],
		['minimal', 'Minimal', 'Cover and one line']
	];

	let element = $state<HTMLElement | null>(null);
	let fullScreen = $state(!!document.fullscreenElement);

	function toggleBrowserFullScreen() {
		if (document.fullscreenElement) void document.exitFullscreen();
		else void document.documentElement.requestFullscreen().catch(() => (fullScreen = false));
	}
	let position = $state({ left: 0, bottom: 0 });

	$effect(() => {
		if (!ui.settingsOpen || !element) return;
		const anchor = document.getElementById('bSettings')?.getBoundingClientRect();
		if (!anchor) return;
		const width = element.offsetWidth;
		position = { left: Math.max(POPOVER.edgeMarginPx, Math.min(anchor.left, innerWidth - width - POPOVER.edgeMarginPx)), bottom: innerHeight - anchor.top + POPOVER.anchorGapPx };
	});

	const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
	const slowestSteps = (steps: Record<string, number>) =>
		Object.entries(steps)
			.toSorted((a, b) => b[1] - a[1])
			.slice(0, 3)
			.map(([step, ms]) => `${step} ${seconds(ms)}`)
			.join(' · ');

	function chooseStyle(style: FullScreenStyle) {
		setFullScreenStyle(style);
		applyFullScreenStyleClass();
	}
</script>

<svelte:document onfullscreenchange={() => (fullScreen = !!document.fullscreenElement)} />

<svelte:window onpointerdown={(event) => ui.settingsOpen && !element?.contains(event.target as Node) && !(event.target as Element).closest('#bSettings') && (ui.settingsOpen = false)} />

<div id="settings" class="pop" class:open={ui.settingsOpen} role="dialog" aria-label="Settings" bind:this={element} style:left="{position.left}px" style:bottom="{position.bottom}px">
	<p class="pop-title">Full-screen style</p>
	<div class="fs-opts">
		{#each options as [style, label, description] (style)}
			<button type="button" class="fs-opt" class:on={ui.fullScreenStyle === style} onclick={() => chooseStyle(style)}>
				<span class="fs-thumb {style}"><i></i><i></i><i></i></span>
				<b>{label}</b><small>{description}</small>
			</button>
		{/each}
	</div>
	<p class="pop-title">Background</p>
	<button type="button" class="set-row" class:on={ui.ripples} onclick={() => setRipples(!ui.ripples)}><span>Ripples<small>Gentle motion with the music</small></span><span class="switch"></span></button>
	<p class="pop-title">Window</p>
	<button type="button" class="set-row" class:on={fullScreen} onclick={toggleBrowserFullScreen}><span>Full screen<small>Hide the browser’s tabs and toolbar</small></span><span class="switch"></span></button>
	<p class="pop-title">Glass</p>
	<button type="button" class="set-row" class:on={glass.enabled} onclick={() => setGlassEnabled(!glass.enabled)}><span>Liquid glass<small>Refracting glass for the player, panels and menus</small></span><span class="switch"></span></button>
	<button
		type="button"
		class="set-row"
		onclick={() => {
			ui.settingsOpen = false;
			void goto(resolve('/glass'));
		}}><span>Tune liquid glass<small>Looks, shape, optics and light</small></span></button
	>
	<p class="pop-title">Library</p>
	<button type="button" class="set-row" disabled={library.status === 'syncing'} onclick={() => resyncLibrary()}>
		<span>{library.status === 'syncing' ? 'Syncing…' : 'Resync now'}<small>{library.meta ? `Synced ${relativeTime(library.meta.syncedAt)}${import.meta.env.DEV && library.leader ? ' · this tab syncs' : ''}` : 'Not synced yet'}</small></span>
	</button>
	{#if import.meta.env.DEV && library.timings}<p class="set-foot">Last sync {seconds(library.timings.fetchMs + library.timings.buildMs + library.timings.writeMs)} · download {seconds(library.timings.fetchMs)} · build {seconds(library.timings.buildMs)}<br />{slowestSteps(library.timings.steps)}</p>{/if}
	{#if library.error}<p class="set-foot">{library.error}</p>{/if}
	<button type="button" class="set-row" onclick={signOut}><span>Sign out<small>{session.credentials?.username ?? ''}</small></span></button>
	{#if import.meta.env.DEV}<p class="set-foot">Field renderer · {ui.fieldRenderer || 'none'}</p>{/if}
</div>
