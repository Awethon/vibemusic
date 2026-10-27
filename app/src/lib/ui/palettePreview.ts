import { isPreviewingPalette, previewPalette } from '../engine/palette.ts';
import { ui } from './state.svelte.ts';

export function installPalettePreview(element: HTMLElement): () => void {
	const onOver = (event: MouseEvent) => {
		if (ui.view.name === 'album') return;
		const target = (event.target as Element).closest<HTMLElement>('[data-preview-album]');
		if (target?.dataset.previewAlbum) previewPalette(target.dataset.previewAlbum);
		else if (isPreviewingPalette()) previewPalette(null);
	};
	const onLeave = () => previewPalette(null);
	element.addEventListener('mouseover', onOver);
	element.addEventListener('mouseleave', onLeave);
	return () => {
		element.removeEventListener('mouseover', onOver);
		element.removeEventListener('mouseleave', onLeave);
	};
}
