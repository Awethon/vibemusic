// A browser-only single-page app: the static build serves one fallback index.html, and the
// components touch window, storage and canvas as soon as they load.
export const ssr = false;
export const prerender = false;
