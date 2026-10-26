import { GLASS_ABOVE, paintBackdrop } from './backdrop.ts';
import type { GlassParams } from './params.ts';
import { createGlassRenderer, type GlassShape, type Region } from './renderer.ts';

export const GLASS_SURFACES = '#capsule, .pop.open, .menu.open';

const FIELD_REPAINT_MS = 120;

function effectiveOpacity(element: Element): number {
	let opacity = 1;
	for (let node: Element | null = element; node && node !== document.body; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
	return opacity;
}

function surfaces(): GlassShape[] {
	const shapes: GlassShape[] = [];
	for (const element of document.querySelectorAll(GLASS_SURFACES)) {
		const rect = element.getBoundingClientRect();
		if (rect.width < 2 || rect.height < 2) continue;
		const alpha = effectiveOpacity(element);
		if (alpha < 0.02) continue;
		const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
		shapes.push({ x: rect.left, y: rect.top, width: rect.width, height: rect.height, radius, alpha });
	}
	return shapes;
}

function regionAround(shapes: GlassShape[], params: GlassParams): Region {
	const margin = Math.max(60, params.shadowBlur * 1.5 + params.shadowDist + params.merge + params.thick * 1.5 + 12);
	const left = Math.max(0, Math.min(...shapes.map((shape) => shape.x)) - margin);
	const top = Math.max(0, Math.min(...shapes.map((shape) => shape.y)) - margin);
	const right = Math.min(innerWidth, Math.max(...shapes.map((shape) => shape.x + shape.width)) + margin);
	const bottom = Math.min(innerHeight, Math.max(...shapes.map((shape) => shape.y + shape.height)) + margin);
	return { x: Math.floor(left), y: Math.floor(top), width: Math.ceil(right - left), height: Math.ceil(bottom - top) };
}

const insideGlass = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest(GLASS_ABOVE) != null;

export function startGlassLayer(canvas: HTMLCanvasElement, params: () => GlassParams): (() => void) | null {
	const renderer = createGlassRenderer(canvas);
	if (!renderer) return null;
	const backdrop = document.createElement('canvas').getContext('2d', { willReadFrequently: false });
	if (!backdrop) return null;
	const field = document.getElementById('field') as HTMLCanvasElement | null;
	let dpr = 0;
	let pageDirty = true;
	let lastShapes = '';
	let lastRegion = '';
	let lastParams = '';
	let lastFieldPaint = 0;
	let frame = 0;

	const markDirty = () => {
		pageDirty = true;
	};
	const observer = new MutationObserver((records) => {
		if (records.some((record) => !insideGlass(record.target))) pageDirty = true;
	});
	observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true, attributeFilter: ['class', 'style', 'src', 'hidden'] });
	addEventListener('scroll', markDirty, true);
	addEventListener('load', markDirty, true);
	addEventListener('resize', markDirty);

	const pageAnimating = () => document.getAnimations().some((animation) => animation.playState === 'running' && animation.effect instanceof KeyframeEffect && animation.effect.target instanceof Element && !animation.effect.target.closest(GLASS_ABOVE));

	const tick = (now: number) => {
		frame = requestAnimationFrame(tick);
		const ratio = Math.min(devicePixelRatio || 1, 2);
		if (ratio !== dpr || canvas.width !== Math.round(innerWidth * ratio) || canvas.height !== Math.round(innerHeight * ratio)) {
			dpr = ratio;
			renderer.resize(innerWidth, innerHeight, dpr);
			pageDirty = true;
			lastShapes = '';
		}
		const shapes = surfaces();
		const current = params();
		const paramsKey = JSON.stringify(current);
		if (!shapes.length) {
			if (lastShapes) renderer.clear();
			lastShapes = '';
			return;
		}
		const region = regionAround(shapes, current);
		const regionKey = `${region.x},${region.y},${region.width},${region.height}`;
		if (field && now - lastFieldPaint > FIELD_REPAINT_MS) {
			lastFieldPaint = now;
			pageDirty = true;
		}
		const repaint = pageDirty || regionKey !== lastRegion || pageAnimating();
		const shapesKey = JSON.stringify(shapes);
		if (!repaint && shapesKey === lastShapes && paramsKey === lastParams) return;
		if (repaint) {
			paintBackdrop(backdrop, region, dpr, field);
			renderer.setScene(backdrop.canvas);
			pageDirty = false;
			lastRegion = regionKey;
		}
		renderer.render(current, shapes, region, region, dpr);
		lastShapes = shapesKey;
		lastParams = paramsKey;
	};
	frame = requestAnimationFrame(tick);

	return () => {
		cancelAnimationFrame(frame);
		observer.disconnect();
		removeEventListener('scroll', markDirty, true);
		removeEventListener('load', markDirty, true);
		removeEventListener('resize', markDirty);
		renderer.clear();
		renderer.dispose();
	};
}
