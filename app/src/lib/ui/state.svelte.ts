import type { AlbumSort, ArtistSort, Filters } from '../library/queries.ts';
import { TOAST } from '../tuning.ts';
import { readPreference, writePreference } from './preferences.ts';

export const FULL_SCREEN_STYLES = ['canvas', 'classic', 'minimal'] as const;
export type FullScreenStyle = (typeof FULL_SCREEN_STYLES)[number];
export type PanelTab = 'queue' | 'lyrics';

export const ui = $state({
	panelOpen: false,
	panelTab: 'queue' as PanelTab,
	fullScreen: false,
	fullScreenStyle: readPreference('fs', FULL_SCREEN_STYLES, 'canvas'),
	ripples: readPreference('ripples', ['on', 'off'] as const, 'on') === 'on',
	sidebarOpen: readPreference('rail', ['open', 'mini'] as const, 'mini') === 'open',
	artistView: readPreference('artistView', ['list', 'grid'] as const, 'list'),
	searchOpen: false,
	settingsOpen: false,
	toast: '',
	filters: { genres: [], decades: [] } as Filters,
	albumSort: 'mostPlayed' as AlbumSort,
	artistSort: 'mostAlbums' as ArtistSort,
	fieldRenderer: ''
});

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function showToast(message: string) {
	ui.toast = message;
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => (ui.toast = ''), TOAST.visibleMs);
}

export function togglePanel(tab: PanelTab) {
	if (ui.panelOpen && ui.panelTab === tab) ui.panelOpen = false;
	else {
		ui.panelOpen = true;
		ui.panelTab = tab;
		ui.fullScreen = false;
	}
}

export function setFullScreen(on: boolean) {
	ui.fullScreen = on;
	if (on) ui.panelOpen = false;
}

export function setFullScreenStyle(style: FullScreenStyle) {
	ui.fullScreenStyle = style;
	writePreference('fs', style);
}

export function setRipples(on: boolean) {
	ui.ripples = on;
	writePreference('ripples', on ? 'on' : 'off');
}

export function toggleSidebar() {
	ui.sidebarOpen = !ui.sidebarOpen;
	writePreference('rail', ui.sidebarOpen ? 'open' : 'mini');
}

export function setArtistView(view: 'list' | 'grid') {
	ui.artistView = view;
	writePreference('artistView', view);
}

export const filtering = () => ui.filters.genres.length > 0 || ui.filters.decades.length > 0;

export function clearFilters() {
	ui.filters = { genres: [], decades: [] };
}
