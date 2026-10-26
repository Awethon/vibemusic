import { ABOVE_PLAYER_GLASS, ABOVE_POPUP_GLASS, paintBackdrop } from './backdrop.ts';
import type { GlassParams } from './params.ts';
import { createGlassRenderer, type GlassRenderer, type GlassShape, type Region } from './renderer.ts';

export type GlassLevel = 'player' | 'popups';

const LEVELS: Record<GlassLevel, { surfaces: string; above: string }> = {
	player: { surfaces: '#capsule', above: ABOVE_PLAYER_GLASS },
	popups: { surfaces: '.pop.open, .menu.open', above: ABOVE_POPUP_GLASS }
};

const PLAYER_RENDERED = 'vibemusic:glass-player-rendered';

function effectiveOpacity(element: Element): number {
	let opacity = 1;
	for (let node: Element | null = element; node && node !== document.body; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
	return opacity;
}

function surfaces(selector: string): GlassShape[] {
	const shapes: GlassShape[] = [];
	for (const element of document.querySelectorAll(selector)) {
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
	const margin = Math.max(60, params.shadowBlur * 1.5 + params.shadowDist + params.thick * 1.5 + 12);
	const left = Math.max(0, Math.min(...shapes.map((shape) => shape.x)) - margin);
	const top = Math.max(0, Math.min(...shapes.map((shape) => shape.y)) - margin);
	const right = Math.min(innerWidth, Math.max(...shapes.map((shape) => shape.x + shape.width)) + margin);
	const bottom = Math.min(innerHeight, Math.max(...shapes.map((shape) => shape.y + shape.height)) + margin);
	return { x: Math.floor(left), y: Math.floor(top), width: Math.ceil(right - left), height: Math.ceil(bottom - top) };
}

const inside = (node: Node, selector: string) => (node instanceof Element ? node : node.parentElement)?.closest(selector) != null;

export function startGlassLayer(canvas: HTMLCanvasElement, level: GlassLevel, params: () => GlassParams): (() => void) | null {
	const { surfaces: selector, above } = LEVELS[level];
	const newBackdrop = () => document.createElement('canvas').getContext('2d');
	let renderer = createGlassRenderer(canvas, level === 'player');
	let backdrop = newBackdrop();
	if (!renderer || !backdrop) return null;
	let lost = false;
	let broken = false;
	let dpr = 0;
	let pageDirty = true;
	let lastShapes = '';
	let lastRegion = '';
	let lastParams = '';
	let frame = 0;

	const markDirty = () => {
		pageDirty = true;
	};
	const rebuild = () => {
		if (canvas.getContext('webgl2')?.isContextLost()) return;
		let next: GlassRenderer | null = null;
		try {
			next = createGlassRenderer(canvas, level === 'player');
		} catch {
			next = null;
		}
		if (!next) return;
		renderer?.dispose(false);
		renderer = next;
		backdrop = newBackdrop();
		broken = false;
		dpr = 0;
		pageDirty = true;
		lastShapes = '';
		lastRegion = '';
	};
	const onLost = (event: Event) => {
		event.preventDefault();
		lost = true;
	};
	const onRestored = () => {
		lost = false;
		rebuild();
	};
	canvas.addEventListener('webglcontextlost', onLost);
	canvas.addEventListener('webglcontextrestored', onRestored);
	const observer = new MutationObserver((records) => {
		if (records.some((record) => !inside(record.target, above))) pageDirty = true;
	});
	observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true, attributeFilter: ['class', 'style', 'src', 'hidden'] });
	addEventListener('scroll', markDirty, true);
	addEventListener('load', markDirty, true);
	addEventListener('resize', markDirty);
	if (level === 'popups') addEventListener(PLAYER_RENDERED, markDirty);

	const pageAnimating = () => document.getAnimations().some((animation) => animation.playState === 'running' && animation.effect instanceof KeyframeEffect && animation.effect.target instanceof Element && !animation.effect.target.closest(above));

	const tick = () => {
		frame = requestAnimationFrame(tick);
		if (broken) rebuild();
		if (lost || !renderer || !backdrop) return;
		try {
			draw(renderer, backdrop);
		} catch {
			broken = true;
		}
	};

	const draw = (gl: GlassRenderer, paint: CanvasRenderingContext2D) => {
		const ratio = Math.min(devicePixelRatio || 1, 2);
		if (ratio !== dpr || canvas.width !== Math.round(innerWidth * ratio) || canvas.height !== Math.round(innerHeight * ratio)) {
			dpr = ratio;
			gl.resize(innerWidth, innerHeight, dpr);
			pageDirty = true;
			lastShapes = '';
		}
		const shapes = surfaces(selector);
		const current = params();
		const paramsKey = JSON.stringify(current);
		if (!shapes.length) {
			if (lastShapes) {
				gl.clear();
				if (level === 'player') dispatchEvent(new Event(PLAYER_RENDERED));
			}
			lastShapes = '';
			return;
		}
		const region = regionAround(shapes, current);
		const regionKey = `${region.x},${region.y},${region.width},${region.height}`;
		const repaint = pageDirty || regionKey !== lastRegion || pageAnimating();
		const shapesKey = JSON.stringify(shapes);
		if (!repaint && shapesKey === lastShapes && paramsKey === lastParams) return;
		if (repaint) {
			paintBackdrop(paint, region, dpr, above);
			gl.setScene(paint.canvas);
			pageDirty = false;
			lastRegion = regionKey;
		}
		gl.render(current, shapes, region, region, dpr);
		if (level === 'player') dispatchEvent(new Event(PLAYER_RENDERED));
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
		removeEventListener(PLAYER_RENDERED, markDirty);
		canvas.removeEventListener('webglcontextlost', onLost);
		canvas.removeEventListener('webglcontextrestored', onRestored);
		renderer?.clear();
		renderer?.dispose(true);
	};
}
