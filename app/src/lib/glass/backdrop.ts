import { fieldSnapshot } from '../visual/fieldSnapshot.ts';
import type { Region } from './renderer.ts';
import { paintScrim } from '../ui/scrim.ts';

const ALWAYS_ABOVE = '.pop, .menu, #palette, #toast, #connection-note, .row-lift';
export const ABOVE_RAIL_GLASS = `#glass-rail, #chrome, #chrome ~ *, ${ALWAYS_ABOVE}`;
export const ABOVE_PLAYER_GLASS = `#glass-player, #glass-popups, #panel, #dock, ${ALWAYS_ABOVE}`;
export const ABOVE_POPUP_GLASS = `#glass-popups, ${ALWAYS_ABOVE}`;

type Box = { left: number; top: number; right: number; bottom: number };

const PAGE_COLOR = '#08070b';

const intersects = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

function parseColor(value: string): number {
	const match = value.match(/rgba?\(([^)]+)\)/);
	if (!match) return 0;
	const parts = match[1].split(/[\s,/]+/).filter(Boolean);
	return parts.length > 3 ? Number(parts[3]) : 1;
}

const radiusOf = (style: CSSStyleDeclaration, box: DOMRect) => Math.min(parseFloat(style.borderTopLeftRadius) || 0, box.width / 2, box.height / 2);

function roundRect(context: CanvasRenderingContext2D, box: DOMRect, radius: number) {
	context.beginPath();
	if (radius > 0) context.roundRect(box.left, box.top, box.width, box.height, radius);
	else context.rect(box.left, box.top, box.width, box.height);
}

function drawImage(context: CanvasRenderingContext2D, image: CanvasImageSource, naturalWidth: number, naturalHeight: number, box: DOMRect, fit: string) {
	if (!naturalWidth || !naturalHeight) return;
	if (fit === 'cover' || fit === 'contain') {
		const scale = fit === 'cover' ? Math.max(box.width / naturalWidth, box.height / naturalHeight) : Math.min(box.width / naturalWidth, box.height / naturalHeight);
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

function drawText(context: CanvasRenderingContext2D, node: Text, style: CSSStyleDeclaration, region: Box) {
	const raw = node.data.replace(/\s+/g, ' ');
	if (!raw.trim()) return;
	const range = document.createRange();
	range.selectNodeContents(node);
	const lines = [...range.getClientRects()].filter((line) => line.width > 0 && line.height > 0);
	if (!lines.length || !lines.some((line) => intersects(line, region))) return;
	context.font = style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
	context.fillStyle = style.color;
	context.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
	context.textBaseline = 'middle';
	const text = transformText(raw.trim(), style.textTransform);
	if (lines.length === 1) {
		context.fillText(text, lines[0].left, lines[0].top + lines[0].height / 2);
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

export function paintBackdrop(context: CanvasRenderingContext2D, region: Region, dpr: number, above: string) {
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
	context.fillStyle = PAGE_COLOR;
	context.fillRect(region.x, region.y, region.width, region.height);
	if (fieldSnapshot.canvas) {
		context.imageSmoothingQuality = 'high';
		context.drawImage(fieldSnapshot.canvas, 0, 0, innerWidth, innerHeight);
	}

	const visit = (element: Element, opacity: number) => {
		if (element instanceof SVGElement || element.matches(above) || element.id === 'field') return;
		const style = getComputedStyle(element);
		if (style.display === 'none' || style.visibility === 'hidden') return;
		const alpha = opacity * Number(style.opacity);
		if (alpha < 0.02) return;
		const rect = element.getBoundingClientRect();
		const clips = style.overflowX !== 'visible' || style.overflowY !== 'visible';
		if (clips && !intersects(rect, box)) return;
		context.save();
		context.globalAlpha = alpha;
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

	for (const child of document.body.children) visit(child, 1);
}
