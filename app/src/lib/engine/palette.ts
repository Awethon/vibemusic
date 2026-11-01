// Decides which album's colours the animated background shows. Priority: a hovered album
// (preview), then an album page opened from that preview, then the playing track's album.
// Previews revert after a delay so moving the pointer across gaps between tiles doesn't flicker.
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
	// Palettes load asynchronously; only the most recent request may apply, or a slow earlier
	// album could land after a newer one.
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

// Called on navigation. Clicking through to an album you were hovering keeps its colours
// ("holds" the page) instead of reverting to the playing track and back again.
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
