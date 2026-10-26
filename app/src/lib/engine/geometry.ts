import { LAYOUT } from '../tuning.ts';

export type Geometry = { columns: number; itemWidth: number; gapX: number; rowHeight: number };

export type Measure = (availableWidth: number) => Geometry;

export function albumGridMeasure(availableWidth: number): Geometry {
	const { gapXPx, gapYPx, minTileWidthPx, captionHeightPx } = LAYOUT.albumGrid;
	const columns = Math.max(1, Math.floor((availableWidth + gapXPx) / (minTileWidthPx + gapXPx)));
	const itemWidth = (availableWidth - gapXPx * (columns - 1)) / columns;
	return { columns, itemWidth, gapX: gapXPx, rowHeight: itemWidth + captionHeightPx + gapYPx };
}

export const fixedRowMeasure =
	(rowHeight: number): Measure =>
	(availableWidth) => ({ columns: 1, itemWidth: availableWidth, gapX: 0, rowHeight });
