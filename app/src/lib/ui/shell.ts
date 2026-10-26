import { bodyHasClass, setBodyClass } from '../engine/dom.ts';
import { wakeFromIdle } from '../engine/idle.svelte.ts';
import { recenterVisibleLyrics } from '../engine/layout.svelte.ts';
import { settlePalette } from '../engine/palette.ts';
import { closePanelInstantly, togglePanelWithLayout } from '../engine/panel.ts';
import { closeAllMenus } from './menu.svelte.ts';
import { FULL_SCREEN_STYLES, ui, type PanelTab } from './state.svelte.ts';

export function applyFullScreenStyleClass() {
	for (const style of FULL_SCREEN_STYLES) setBodyClass(`fs-${style}`, ui.fullScreenStyle === style);
}

export function setFullScreen(open: boolean) {
	if (open === bodyHasClass('now-open')) return;
	closeAllMenus();
	wakeFromIdle();
	if (open) {
		settlePalette(true);
		closePanelInstantly();
		ui.fullScreen = true;
		setBodyClass('now-open', true);
		requestAnimationFrame(recenterVisibleLyrics);
		return;
	}
	ui.fullScreen = false;
	setBodyClass('now-open', false);
	settlePalette(false);
	if (bodyHasClass('panel-open')) requestAnimationFrame(recenterVisibleLyrics);
}

export const toggleFullScreen = () => setFullScreen(!bodyHasClass('now-open'));

export function togglePanel(forceOpen?: boolean, tab?: PanelTab) {
	let shouldOpen = forceOpen;
	if (bodyHasClass('now-open')) {
		setFullScreen(false);
		shouldOpen = true;
	}
	togglePanelWithLayout(shouldOpen ?? !bodyHasClass('panel-open'), tab);
}

const panelShows = (tab: PanelTab) => bodyHasClass('panel-open') && ui.panelTab === tab;

export const togglePanelTab = (tab: PanelTab) => togglePanel(!panelShows(tab), tab);
