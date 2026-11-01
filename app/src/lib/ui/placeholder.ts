import { thumbHashToDataURL } from 'thumbhash';

const decoded = new Map<string, string | null>();

function thumbUrl(hash: string): string | null {
	if (!hash) return null;
	let url = decoded.get(hash);
	if (url === undefined) {
		try {
			url = thumbHashToDataURL(Uint8Array.from(atob(hash), (char) => char.charCodeAt(0)));
		} catch {
			url = null;
		}
		decoded.set(hash, url);
	}
	return url;
}

export type Placeholder = { color: string; thumb: string };

export function placeholderStyle(art: Placeholder | undefined): string | undefined {
	if (!art) return undefined;
	const thumb = thumbUrl(art.thumb);
	return (
		[
			art.color && `background-color: ${art.color}`,
			thumb && `background-image: url("${thumb}"); background-size: cover; background-position: center`
		]
			.filter(Boolean)
			.join('; ') || undefined
	);
}
