import { resolve } from '$app/paths';
import { formFactor } from './formFactor.svelte.ts';
import type { IconName } from './icons.ts';
import { ui } from './state.svelte.ts';

export type SectionId = 'home' | 'artists' | 'playlists' | 'timeline' | 'radio';
export type Section = { id: SectionId; label: string; shortLabel: string; icon: IconName; href: string };

const ALL: readonly Section[] = [
	{ id: 'home', label: 'Your Music', shortLabel: 'Home', icon: 'home', href: resolve('/') },
	{ id: 'artists', label: 'Artists', shortLabel: 'Artists', icon: 'mic', href: resolve('/artists') },
	{ id: 'playlists', label: 'Playlists', shortLabel: 'Playlists', icon: 'lists', href: resolve('/playlists') },
	{ id: 'timeline', label: 'Timeline', shortLabel: 'Timeline', icon: 'timeline', href: resolve('/timeline') },
	{ id: 'radio', label: 'Radio', shortLabel: 'Radio', icon: 'radio', href: resolve('/radio') }
];

export const timelineAvailable = () => !formFactor.phone;

export function visibleSections(hasRadio: boolean): Section[] {
	return ALL.filter((section) => {
		if (section.id === 'timeline') return ui.showTimeline && timelineAvailable();
		if (section.id === 'radio') return ui.showRadio && hasRadio;
		return true;
	});
}

export function sectionFor(routeId: string | null): SectionId {
	const route = routeId ?? '/';
	if (route.startsWith('/artist')) return 'artists';
	if (route.startsWith('/playlist')) return 'playlists';
	if (route.startsWith('/timeline')) return 'timeline';
	if (route.startsWith('/radio')) return 'radio';
	return 'home';
}
