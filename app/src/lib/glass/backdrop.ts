// WebGL can't read the page's pixels, so the glass needs its own picture of what is behind it.
// This repaints an approximation of the DOM into a 2D canvas: the background field snapshot,
// then backgrounds, borders, images, canvases and text of every element under the glass region.
import { fieldSnapshot } from '../visual/fieldSnapshot.ts';
import type { Region } from './renderer.ts';
import { paintScrim } from '../ui/scrim.ts';

// Elements that sit above a given glass layer. They are skipped when painting its backdrop, and
// changes inside them don't trigger a repaint (layer.ts).
const ALWAYS_ABOVE = '.pop, .menu, #palette, #toast, #connection-note, .row-lift';
export const ABOVE_RAIL_GLASS = `#glass-rail, #chrome, #chrome ~ *, ${ALWAYS_ABOVE}`;
export const ABOVE_PLAYER_GLASS = `#glass-player, #glass-popups, #panel, #dock, ${ALWAYS_ABOVE}`;
export const ABOVE_POPUP_GLASS = `#glass-popups, ${ALWAYS_ABOVE}`;

type Box = { left: number; top: number; right: number; bottom: number };

// Fill under the field snapshot; same as the theme-color in app.html (the CSS body is #0a090d).
const PAGE_COLOR = '#08070b';

const intersects = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

// Returns only the alpha of a computed rgb()/rgba() colour; used to skip transparent fills.
function parseColor(value: string): number {
	const match = value.match(/rgba?\(([^)]+)\)/);
	if (!match) return 0;
	const parts = match[1].split(/[\s,/]+/).filter(Boolean);
	return parts.length > 3 ? Number(parts[3]) : 1;
}

const radiusOf = (style: CSSStyleDeclaration, box: DOMRect) =>
	Math.min(parseFloat(style.borderTopLeftRadius) || 0, box.width / 2, box.height / 2);

function roundRect(context: CanvasRenderingContext2D, box: DOMRect, radius: number) {
	context.beginPath();
	if (radius > 0) context.roundRect(box.left, box.top, box.width, box.height, radius);
	else context.rect(box.left, box.top, box.width, box.height);
}

function drawImage(
	context: CanvasRenderingContext2D,
	image: CanvasImageSource,
	naturalWidth: number,
	naturalHeight: number,
	box: DOMRect,
	fit: string
) {
	if (!naturalWidth || !naturalHeight) return;
	if (fit === 'cover' || fit === 'contain') {
		const scale =
			fit === 'cover'
				? Math.max(box.width / naturalWidth, box.height / naturalHeight)
				: Math.min(box.width / naturalWidth, box.height / naturalHeight);
		const w = naturalWidth * scale;
		const h = naturalHeight * scale;
		context.drawImage(image, box.left + (box.width - w) / 2, box.top + (box.height - h) / 2, w, h);
	} else {
		context.drawImage(image, box.left, box.top, box.width, box.height);
	}
}

function transformText(text: string, transform: string) {
	if (transform === 'uppercase') return text.toUpperCase();
	if (transform === 'lowercase') return text.toLowerCase();
	return text;
}

// One box per line. The browser can report a line as several boxes: text cut off with an
// ellipsis comes back as one box for the whole text and one for the visible part, both on the
// same line. Treating those as separate lines drew the rest of the text over its start.
function lineBoxes(rects: DOMRect[]): DOMRect[] {
	const lines: DOMRect[] = [];
	for (const rect of rects.toSorted((a, b) => a.top - b.top || a.left - b.left)) {
		const line = lines.at(-1);
		if (line && Math.abs(rect.top + rect.height / 2 - (line.top + line.height / 2)) < line.height / 2) {
			const left = Math.min(line.left, rect.left);
			lines[lines.length - 1] = new DOMRect(left, line.top, Math.max(line.right, rect.right) - left, line.height);
		} else lines.push(rect);
	}
	return lines;
}

// Shortens a single-line text to what the page shows when the element ends it with an ellipsis.
function ellipsized(context: CanvasRenderingContext2D, text: string, width: number): string {
	if (context.measureText(text).width <= width) return text;
	let end = text.length;
	while (end > 0 && context.measureText(`${text.slice(0, end).trimEnd()}…`).width > width) end -= 1;
	return `${text.slice(0, end).trimEnd()}…`;
}

function drawText(context: CanvasRenderingContext2D, node: Text, style: CSSStyleDeclaration, region: Box) {
	const raw = node.data.replace(/\s+/g, ' ');
	if (!raw.trim()) return;
	const range = document.createRange();
	range.selectNodeContents(node);
	// The browser already wrapped the text; its line boxes come from the Range. Words are then
	// re-flowed greedily into those boxes, which is close enough behind blurred, refracting glass.
	const lines = lineBoxes([...range.getClientRects()].filter((line) => line.width > 0 && line.height > 0));
	if (!lines.length || !lines.some((line) => intersects(line, region))) return;
	context.font = style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
	context.fillStyle = style.color;
	context.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
	context.textBaseline = 'middle';
	const text = transformText(raw.trim(), style.textTransform);
	if (lines.length === 1) {
		const [line] = lines;
		const parent = node.parentElement;
		const shown =
			style.textOverflow === 'ellipsis' && parent
				? ellipsized(context, text, parent.getBoundingClientRect().right - (parseFloat(style.paddingRight) || 0) - line.left)
				: text;
		context.fillText(shown, line.left, line.top + line.height / 2);
		return;
	}
	const words = text.split(' ');
	let word = 0;
	for (const line of lines) {
		let content = '';
		while (word < words.length) {
			const next = content ? `${content} ${words[word]}` : words[word];
			if (content && context.measureText(next).width > line.width + 1) break;
			content = next;
			word += 1;
		}
		if (intersects(line, region)) context.fillText(content, line.left, line.top + line.height / 2);
	}
}

// The main view scrolls on the compositor without waiting for JavaScript. The glass paints what
// is inside it as a separate "scroll" layer, which the renderer shifts by the scroll distance
// instead of repainting it every frame; everything else is the "fixed" layer.
export const SCROLLER = '#main';

export type BackdropLayer = 'all' | 'fixed' | 'scroll';

function ancestorOpacity(element: Element): number {
	let opacity = 1;
	for (let node = element.parentElement; node && node !== document.body; node = node.parentElement)
		opacity *= Number(getComputedStyle(node).opacity);
	return opacity;
}

export function paintBackdrop(context: CanvasRenderingContext2D, region: Region, dpr: number, above: string, layer: BackdropLayer = 'all') {
	const canvas = context.canvas;
	const width = Math.max(1, Math.round(region.width * dpr));
	const height = Math.max(1, Math.round(region.height * dpr));
	if (canvas.width !== width || canvas.height !== height) {
		canvas.width = width;
		canvas.height = height;
	}
	const box: Box = { left: region.x, top: region.y, right: region.x + region.width, bottom: region.y + region.height };
	context.setTransform(dpr, 0, 0, dpr, -region.x * dpr, -region.y * dpr);
	context.globalAlpha = 1;
	if (layer === 'scroll') context.clearRect(region.x, region.y, region.width, region.height);
	else {
		context.fillStyle = PAGE_COLOR;
		context.fillRect(region.x, region.y, region.width, region.height);
		if (fieldSnapshot.canvas) {
			context.imageSmoothingQuality = 'high';
			context.drawImage(fieldSnapshot.canvas, 0, 0, innerWidth, innerHeight);
		}
	}

	// SVG icons are not painted. #field (the animated background) is already drawn above from
	// its snapshot, since reading the live GPU canvas every frame is too slow.
	const visit = (element: Element, opacity: number) => {
		if (element instanceof SVGElement || element.matches(above) || element.id === 'field') return;
		if (layer === 'fixed' && element.matches(SCROLLER)) return;
		const style = getComputedStyle(element);
		if (style.display === 'none' || style.visibility === 'hidden') return;
		const alpha = opacity * Number(style.opacity);
		if (alpha < 0.02) return;
		const rect = element.getBoundingClientRect();
		// The scroll layer is painted beyond the scroller's visible box, so content is ready to slide in.
		const clips = (style.overflowX !== 'visible' || style.overflowY !== 'visible') && !(layer === 'scroll' && element.matches(SCROLLER));
		if (clips && !intersects(rect, box)) return;
		context.save();
		context.globalAlpha = alpha;
		// The scrim is a CSS gradient, which can't be read back from computed style, so it has its own painter.
		if (element.id === 'scrim') {
			paintScrim(context, innerWidth, innerHeight);
			context.restore();
			return;
		}
		const radius = radiusOf(style, rect);
		if (rect.width && rect.height && intersects(rect, box)) {
			if (parseColor(style.backgroundColor) > 0) {
				context.fillStyle = style.backgroundColor;
				roundRect(context, rect, radius);
				context.fill();
			}
			const border = parseFloat(style.borderTopWidth) || 0;
			if (border > 0 && parseColor(style.borderTopColor) > 0) {
				context.strokeStyle = style.borderTopColor;
				context.lineWidth = border;
				roundRect(context, rect, radius);
				context.stroke();
			}
			// Lower glass layers are canvases too, so upper layers pick them up through the canvas branch.
			if (element instanceof HTMLImageElement && element.complete && element.naturalWidth && !element.classList.contains('img-broken')) {
				context.save();
				roundRect(context, rect, radius);
				context.clip();
				drawImage(context, element, element.naturalWidth, element.naturalHeight, rect, style.objectFit);
				context.restore();
			} else if (element instanceof HTMLCanvasElement && element.width && element.height) {
				try {
					drawImage(context, element, element.width, element.height, rect, style.objectFit);
				} catch {
					context.globalAlpha = alpha;
				}
			}
		}
		if (clips) {
			roundRect(context, rect, radius);
			context.clip();
		}
		for (const child of element.childNodes) {
			if (child instanceof Text) drawText(context, child, style, box);
			else if (child instanceof Element) visit(child, alpha);
		}
		context.restore();
	};

	if (layer !== 'scroll') {
		for (const child of document.body.children) visit(child, 1);
		return;
	}
	const scroller = document.querySelector(SCROLLER);
	if (scroller && !scroller.closest(above)) visit(scroller, ancestorOpacity(scroller));
}
