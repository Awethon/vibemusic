// One glass canvas per level (rail, player, popups), stacked in z-order. Each frame it finds the
// glass surfaces, and only when something behind them changed repaints the backdrop and redraws.
// Started from GlassLayer.svelte inside untrack, since it reads layout and runs its own loop.
import { ABOVE_PLAYER_GLASS, ABOVE_POPUP_GLASS, ABOVE_RAIL_GLASS, paintBackdrop } from './backdrop.ts';
import { glassMargin, RENDER, scenePad, type GlassParams } from './params.ts';
import { fieldSnapshot } from '../visual/fieldSnapshot.ts';
import { createGlassRenderer, type GlassRenderer, type GlassShape, type Region } from './renderer.ts';

export type GlassLevel = 'rail' | 'player' | 'popups';

const LEVELS: Record<GlassLevel, { surfaces: string; above: string }> = {
	rail: { surfaces: '#rail', above: ABOVE_RAIL_GLASS },
	player: { surfaces: '#capsule, #panel', above: ABOVE_PLAYER_GLASS },
	popups: { surfaces: '.pop.open', above: ABOVE_POPUP_GLASS }
};

// Popup glass refracts the player glass canvas beneath it, which changes without any DOM
// mutation, so the player level announces each redraw.
const PLAYER_RENDERED = 'vibemusic:glass-player-rendered';

function effectiveOpacity(element: Element): number {
	let opacity = 1;
	for (let node: Element | null = element; node && node !== document.body; node = node.parentElement)
		opacity *= Number(getComputedStyle(node).opacity);
	return opacity;
}

function surfaces(selector: string): GlassShape[] {
	const shapes: GlassShape[] = [];
	for (const element of document.querySelectorAll(selector)) {
		const rect = element.getBoundingClientRect();
		if (rect.width < 2 || rect.height < 2 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight)
			continue;
		// The rail's visible panel is its ::before, so that's where its radius and opacity live.
		const backing = element.id === 'rail' ? getComputedStyle(element, '::before') : getComputedStyle(element);
		const alpha = effectiveOpacity(element) * Number(backing.opacity);
		if (alpha < 0.02) continue;
		const radius = parseFloat(backing.borderTopLeftRadius) || 0;
		shapes.push({ x: rect.left, y: rect.top, width: rect.width, height: rect.height, radius, alpha });
	}
	return shapes;
}

function around(shape: GlassShape, by: number): Region {
	const left = Math.floor(Math.max(0, shape.x - by));
	const top = Math.floor(Math.max(0, shape.y - by));
	const right = Math.ceil(Math.min(innerWidth, shape.x + shape.width + by));
	const bottom = Math.ceil(Math.min(innerHeight, shape.y + shape.height + by));
	return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function subtract(rect: Region, cut: Region): Region[] {
	const right = rect.x + rect.width;
	const bottom = rect.y + rect.height;
	const cutRight = cut.x + cut.width;
	const cutBottom = cut.y + cut.height;
	if (cut.x >= right || cutRight <= rect.x || cut.y >= bottom || cutBottom <= rect.y) return [rect];
	const pieces: Region[] = [];
	if (cut.y > rect.y) pieces.push({ x: rect.x, y: rect.y, width: rect.width, height: cut.y - rect.y });
	if (cutBottom < bottom) pieces.push({ x: rect.x, y: cutBottom, width: rect.width, height: bottom - cutBottom });
	const bandTop = Math.max(rect.y, cut.y);
	const bandHeight = Math.min(bottom, cutBottom) - bandTop;
	if (cut.x > rect.x) pieces.push({ x: rect.x, y: bandTop, width: cut.x - rect.x, height: bandHeight });
	if (cutRight < right) pieces.push({ x: cutRight, y: bandTop, width: right - cutRight, height: bandHeight });
	return pieces;
}

// Each shape's draw area (outline plus shadow/rim margin) minus the areas of every later shape,
// so overlapping margins are drawn by exactly one pass. Shapes are sorted by size, so the larger one owns the overlap.
function drawAreas(shapes: GlassShape[], params: GlassParams): Region[][] {
	const margin = glassMargin(params);
	const areas = shapes.map((shape) => around(shape, margin));
	return areas.map((area, index) =>
		areas.slice(index + 1).reduce((pieces, later) => pieces.flatMap((piece) => subtract(piece, later)), [area])
	);
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
	let lastRegions: string[] = [];
	let lastParams = '';
	let fieldVersion = -1;
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
		lastRegions = [];
	};
	// preventDefault tells the browser we can restore, otherwise webglcontextrestored never fires.
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
	// Repainting the backdrop walks the whole DOM, so it only happens when the page actually
	// changed. Mutations inside elements above this layer can't affect what's behind the glass.
	const observer = new MutationObserver((records) => {
		if (records.some((record) => !inside(record.target, above))) pageDirty = true;
	});
	observer.observe(document.body, {
		subtree: true,
		childList: true,
		attributes: true,
		characterData: true,
		attributeFilter: ['class', 'style', 'src', 'hidden']
	});
	addEventListener('scroll', markDirty, true);
	addEventListener('load', markDirty, true);
	addEventListener('resize', markDirty);
	if (level === 'popups') addEventListener(PLAYER_RENDERED, markDirty);

	// Web Animations (FLIP, queue motion) move things without mutating the DOM, so while any run
	// below this layer the backdrop is repainted every frame.
	const pageAnimating = () =>
		document
			.getAnimations()
			.some(
				(animation) =>
					animation.playState === 'running' &&
					animation.effect instanceof KeyframeEffect &&
					animation.effect.target instanceof Element &&
					!animation.effect.target.closest(above)
			);

	const tick = () => {
		frame = requestAnimationFrame(tick);
		// A draw that threw marks the renderer broken; try a fresh one next frame instead of stopping.
		if (broken) rebuild();
		if (lost || !renderer || !backdrop) return;
		try {
			draw(renderer, backdrop);
		} catch {
			broken = true;
		}
	};

	const draw = (gl: GlassRenderer, paint: CanvasRenderingContext2D) => {
		const ratio = Math.min(devicePixelRatio || 1, RENDER.maxPixelRatio);
		if (ratio !== dpr || canvas.width !== Math.round(innerWidth * ratio) || canvas.height !== Math.round(innerHeight * ratio)) {
			dpr = ratio;
			gl.resize(innerWidth, innerHeight, dpr);
			pageDirty = true;
			lastShapes = '';
		}
		const shapes = surfaces(selector).toSorted((a, b) => a.width * a.height - b.width * b.height);
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
		// Each shape gets its own backdrop texture, painted only for the region around it.
		const pad = glassMargin(current) + scenePad(current);
		const regions = shapes.map((shape) => around(shape, pad));
		const areas = drawAreas(shapes, current);
		const regionKeys = regions.map((region) => `${region.x},${region.y},${region.width},${region.height}`);
		const sceneStale = pageDirty || fieldVersion !== fieldSnapshot.version || pageAnimating();
		const shapesKey = JSON.stringify(shapes);
		if (!sceneStale && regionKeys.join('|') === lastRegions.join('|') && shapesKey === lastShapes && paramsKey === lastParams) return;
		gl.keepSlots(shapes.length);
		gl.clear();
		shapes.forEach((shape, index) => {
			if (sceneStale || regionKeys[index] !== lastRegions[index]) {
				paintBackdrop(paint, regions[index], Math.min(dpr, RENDER.backdropPixelRatio), above);
				gl.setScene(paint.canvas, index);
			}
			gl.render(current, shapes, areas[index], regions[index], dpr, index);
		});
		pageDirty = false;
		lastRegions = regionKeys;
		fieldVersion = fieldSnapshot.version;
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
