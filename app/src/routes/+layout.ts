// A browser-only single-page app: the static build serves one fallback index.html, and the
// components touch window, storage and canvas as soon as they load.
import { reloadGlass } from '#lib/glass/settings.svelte.ts';
import { serverConfig } from '#lib/serverConfig.ts';
import { setPreferenceDefaults } from '#lib/ui/preferences.ts';
import { reloadPreferences } from '#lib/ui/state.svelte.ts';

export const ssr = false;
export const prerender = false;

// The instance's settings defaults are applied before the first render, so a default background
// or glass look doesn't swap in after the page has shown the built-in one.
export async function load() {
	setPreferenceDefaults((await serverConfig()).settings);
	reloadPreferences();
	reloadGlass();
}
