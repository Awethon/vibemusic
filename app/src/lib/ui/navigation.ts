import { updatePalettePageHold } from '../engine/palette.ts';
import { closeAllMenus } from './menu.svelte.ts';
import { setFullScreen } from './shell.ts';
import { ui } from './state.svelte.ts';

export function showView(routeId: string | null, params: Record<string, string>) {
	const route = routeId ?? '/';
	const name = route === '/' ? 'home' : (route.split('/')[1] ?? 'home');
	const id = params.id ?? params.kind ?? '';
	ui.view = { name, id };
	updatePalettePageHold(name, id);
	closeAllMenus();
	setFullScreen(false);
}
