import type { AlbumSort, ArtistSort, Filters } from '../library/queries.ts';
import { TOAST } from '../tuning.ts';
import { readPreference, writePreference } from './preferences.ts';

export const FULL_SCREEN_STYLES = ['canvas', 'classic', 'minimal'] as const;
export type FullScreenStyle = (typeof FULL_SCREEN_STYLES)[number];
export type PanelTab = 'queue' | 'lyrics';
export type FilterKind = 'genre' | 'decade';

export const ui = $state({
	panelOpen: false,
	panelTab: 'queue' as PanelTab,
	fullScreen: false,
	fullScreenStyle: readPreference('fs', FULL_SCREEN_STYLES, 'canvas'),
	ripples: readPreference('ripples', ['on', 'off'] as const, 'on') === 'on',
	railExpanded: readPreference('rail', ['open', 'mini'] as const, 'mini') === 'open',
	artistView: readPreference('artistView', ['list', 'grid'] as const, 'list'),
	searchOpen: false,
	settingsOpen: false,
	filterPopover: null as { kind: FilterKind; left: number; top: number } | null,
	queuePressed: false,
	toast: '',
	toastVisible: false,
	filters: { genres: [], decades: [] } as Filters,
	albumSort: 'mostPlayed' as AlbumSort,
	artistSort: 'mostAlbums' as ArtistSort,
	fieldRenderer: '',
	view: { name: 'home', id: '' }
});

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function showToast(message: string) {
	ui.toast = message;
	ui.toastVisible = true;
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => (ui.toastVisible = false), TOAST.visibleMs);
}

export function setFullScreenStyle(style: FullScreenStyle) {
	ui.fullScreenStyle = style;
	writePreference('fs', style);
}

export function setRipples(on: boolean) {
	ui.ripples = on;
	writePreference('ripples', on ? 'on' : 'off');
}

export function setArtistView(view: 'list' | 'grid') {
	ui.artistView = view;
	writePreference('artistView', view);
}

export const filtering = () => ui.filters.genres.length > 0 || ui.filters.decades.length > 0;

export function clearFilters() {
	ui.filters = { genres: [], decades: [] };
	ui.filterPopover = null;
}

export function filterSuffix(): string {
	const parts = [...ui.filters.genres, ...ui.filters.decades.map((decade) => `${decade}s`)];
	return parts.length ? ` · ${parts.join(' · ')}` : '';
}
