// Marks every failed <img> with .img-broken (CSS hides the browser's broken-image icon; the glass
// backdrop skips them) and reloads them all when the server becomes reachable again.
// load/error don't bubble, hence the capture-phase listeners on document.
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
			// Assigning the same src again is a no-op; clearing it first forces a new request.
			const source = image.src;
			image.removeAttribute('src');
			image.src = source;
		}
	});
}
