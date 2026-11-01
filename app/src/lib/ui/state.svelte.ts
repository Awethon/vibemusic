import type { AlbumSort, ArtistSort, Filters } from '../library/queries.ts';
import { TOAST } from '../tuning.ts';
import { readPreference, writePreference } from './preferences.ts';

export const FULL_SCREEN_STYLES = ['minimal', 'classic'] as const;
export type FullScreenStyle = (typeof FULL_SCREEN_STYLES)[number];
export type PanelTab = 'queue' | 'lyrics';
export type FilterKind = 'genre' | 'decade';
// 'field' is the drifting colour field (visual/field.ts); 'amber' is the caustics (visual/amber.ts).
export const BACKGROUNDS = ['field', 'amber'] as const;
export type BackgroundStyle = (typeof BACKGROUNDS)[number];

export const ui = $state({
	panelOpen: false,
	panelTab: 'queue' as PanelTab,
	fullScreen: false,
	fullScreenStyle: readPreference('fs', FULL_SCREEN_STYLES, 'minimal'),
	background: readPreference('background', BACKGROUNDS, 'field'),
	ripples: readPreference('ripples', ['on', 'off'] as const, 'off') === 'on',
	railExpanded: readPreference('rail', ['open', 'mini'] as const, 'mini') === 'open',
	artistView: readPreference('artistView', ['list', 'grid'] as const, 'list'),
	showTimeline: readPreference('nav.timeline', ['on', 'off'] as const, 'on') === 'on',
	showRadio: readPreference('nav.radio', ['on', 'off'] as const, 'on') === 'on',
	searchOpen: false,
	settingsOpen: false,
	devicesOpen: false,
	filterPopover: null as { kind: FilterKind } | null,
	queuePressed: false,
	toast: '',
	// A share link waiting to be copied by hand (see ShareLink.svelte); empty when closed.
	shareLink: '',
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

export function showShareLink(url: string) {
	ui.shareLink = url;
}

export function closeShareLink() {
	ui.shareLink = '';
}

export function setFullScreenStyle(style: FullScreenStyle) {
	ui.fullScreenStyle = style;
	writePreference('fs', style);
}

export function setBackground(style: BackgroundStyle) {
	ui.background = style;
	writePreference('background', style);
}

export function setRipples(on: boolean) {
	ui.ripples = on;
	writePreference('ripples', on ? 'on' : 'off');
}

export function setNavItem(item: 'timeline' | 'radio', on: boolean) {
	if (item === 'timeline') ui.showTimeline = on;
	else ui.showRadio = on;
	writePreference(`nav.${item}`, on ? 'on' : 'off');
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
