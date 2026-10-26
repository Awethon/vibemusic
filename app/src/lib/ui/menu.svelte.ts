import { ui } from './state.svelte.ts';

export type MenuItem = { label: string; hint?: string; run: () => void | Promise<void> } | { separator: true } | { heading: string } | { group: MenuItem[] };

export const menu = $state({ open: false, x: 0, y: 0, items: [] as MenuItem[] });

export function openMenu(event: MouseEvent, items: MenuItem[] | Promise<MenuItem[]>) {
	event.preventDefault();
	event.stopPropagation();
	const { clientX, clientY } = event;
	ui.filterPopover = null;
	void Promise.resolve(items).then((resolved) => {
		menu.items = resolved;
		menu.x = clientX;
		menu.y = clientY;
		menu.open = true;
	});
}

export function closeMenu() {
	menu.open = false;
}

export function closeAllMenus() {
	menu.open = false;
	ui.settingsOpen = false;
	ui.filterPopover = null;
}

export const anyMenuOpen = () => menu.open || ui.settingsOpen || !!ui.filterPopover;
