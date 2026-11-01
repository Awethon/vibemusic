// Attachment for a wrapping strip whose last child is a "more" link: hides items from the end
// until everything, including the "more" link, fits in the given number of rows. Used on phones.
import type { Attachment } from 'svelte/attachments';

export function fitRows(rows: number): Attachment<HTMLElement> {
	return (box) => {
		const fit = () => {
			const items = [...box.children] as HTMLElement[];
			const more = items.at(-1);
			const names = items.slice(0, -1);
			if (!more || !names.length) return;
			// Unhide everything first so rows are measured from the natural wrap, not the previous fit.
			for (const name of names) name.hidden = false;
			const tops = [...new Set(names.map((name) => name.offsetTop))].toSorted((a, b) => a - b);
			const lastTop = tops[rows - 1];
			if (lastTop === undefined) return;
			const lastRowEnd = lastTop + names[0].offsetHeight;
			for (let index = names.length - 1; index >= 0; index--) {
				if (names[index].offsetTop <= lastTop && more.offsetTop < lastRowEnd) break;
				names[index].hidden = true;
			}
		};
		const resizes = new ResizeObserver(fit);
		const changes = new MutationObserver(fit);
		resizes.observe(box);
		changes.observe(box, { childList: true });
		fit();
		return () => {
			resizes.disconnect();
			changes.disconnect();
			for (const item of box.children) (item as HTMLElement).hidden = false;
		};
	};
}
