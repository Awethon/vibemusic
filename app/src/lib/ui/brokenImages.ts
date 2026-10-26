import { onReconnect } from '../connection.svelte.ts';

const BROKEN = 'img-broken';

export function installBrokenImageRetry() {
	const mark = (event: Event) => {
		if (event.target instanceof HTMLImageElement) event.target.classList.toggle(BROKEN, event.type === 'error');
	};
	document.addEventListener('error', mark, true);
	document.addEventListener('load', mark, true);
	onReconnect(() => {
		for (const image of document.querySelectorAll<HTMLImageElement>(`img.${BROKEN}`)) {
			const source = image.src;
			image.removeAttribute('src');
			image.src = source;
		}
	});
}
