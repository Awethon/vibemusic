import { albumPalette } from '../library/palette.ts';
import { PALETTE } from '../tuning.ts';
import type { Field, FieldPaletteOptions } from '../visual/field.ts';

let field: Field | null = null;
let shownColors: string[] = [];
let requestNumber = 0;
let playingAlbumId = '';

const preview = {
	albumId: null as string | null,
	pageAlbumId: null as string | null,
	revertTimer: undefined as ReturnType<typeof setTimeout> | undefined
};

export function attachField(attached: Field | null) {
	field = attached;
	if (field && shownColors.length) field.setPalette(shownColors, { instant: true });
}

function showAlbum(albumId: string | null, options: FieldPaletteOptions) {
	if (!albumId) return;
	const request = ++requestNumber;
	void albumPalette(albumId)
		.then((colors) => {
			if (request !== requestNumber || !colors.length) return;
			shownColors = colors;
			field?.setPalette(colors, options);
		})
		.catch(() => {});
}

const baseAlbumId = () => preview.pageAlbumId ?? (playingAlbumId || null);

function scheduleRevertToBase() {
	preview.revertTimer = setTimeout(() => {
		if (!preview.albumId) return;
		preview.albumId = null;
		showAlbum(baseAlbumId(), { rate: PALETTE.revertRate });
	}, PALETTE.revertDelayMs);
}

export function previewPalette(albumId: string | null) {
	clearTimeout(preview.revertTimer);
	const base = baseAlbumId();
	if (albumId && base && albumId === base && !preview.albumId) return;
	if (!albumId) {
		scheduleRevertToBase();
		return;
	}
	if (preview.albumId === albumId) return;
	preview.albumId = albumId;
	showAlbum(albumId, { rate: PALETTE.hoverPreviewRate });
}

export function settlePalette(toPlayingTrack: boolean) {
	clearTimeout(preview.revertTimer);
	preview.albumId = null;
	showAlbum(toPlayingTrack ? playingAlbumId || null : baseAlbumId(), { rate: PALETTE.revertRate });
}

export function followTrackPalette(albumId: string) {
	const firstTrack = !playingAlbumId;
	playingAlbumId = albumId;
	if (!preview.albumId && !preview.pageAlbumId) showAlbum(albumId, firstTrack ? { instant: true } : { rate: PALETTE.trackChangeRate });
}

export function updatePalettePageHold(view: string, viewId: string) {
	const previousPageAlbumId = preview.pageAlbumId;
	const openingPreviewedAlbum = view === 'album' && preview.albumId === viewId;
	const stayingOnSameAlbum = !!previousPageAlbumId && view === 'album' && previousPageAlbumId === viewId;
	if (openingPreviewedAlbum) preview.pageAlbumId = viewId;
	else preview.pageAlbumId = stayingOnSameAlbum ? previousPageAlbumId : null;
	if (openingPreviewedAlbum) {
		clearTimeout(preview.revertTimer);
		preview.albumId = null;
	} else {
		previewPalette(null);
	}
	if (previousPageAlbumId && !preview.pageAlbumId && !preview.albumId) showAlbum(baseAlbumId(), { rate: PALETTE.revertRate });
}

export const isPreviewingPalette = () => !!preview.albumId;
