// WebGL2 side of the glass: uploads each shape's painted backdrop as a texture ("slot"), keeps a
// blurred copy for frost, and draws the glass shader with a scissor per draw area.
import { lightVector, RENDER, type GlassParams } from './params.ts';
import { BLUR, GLASS, MAX_SHAPES, VERT } from './shaders.ts';

export type GlassShape = { x: number; y: number; width: number; height: number; radius: number; alpha: number };
export type Region = { x: number; y: number; width: number; height: number };

type Target = { tex: WebGLTexture; fbo: WebGLFramebuffer; width: number; height: number };
type Program = { program: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };

const TINT: [number, number, number] = [0.04, 0.045, 0.06];

export function createGlassRenderer(canvas: HTMLCanvasElement, keepFrame: boolean) {
	const gl = canvas.getContext('webgl2', {
		antialias: false,
		alpha: true,
		premultipliedAlpha: true,
		depth: false,
		stencil: false,
		// The player canvas is read back by the popup level's backdrop painter, and an unpreserved
		// buffer reads as blank once the frame has been composited.
		preserveDrawingBuffer: keepFrame
	});
	if (!gl) return null;
	const context = gl;

	function compile(fragment: string): Program {
		const program = context.createProgram();
		for (const [type, source] of [
			[context.VERTEX_SHADER, VERT],
			[context.FRAGMENT_SHADER, fragment]
		] as const) {
			const shader = context.createShader(type)!;
			context.shaderSource(shader, source);
			context.compileShader(shader);
			if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) throw new Error(context.getShaderInfoLog(shader) ?? 'shader failed');
			context.attachShader(program, shader);
		}
		context.linkProgram(program);
		if (!context.getProgramParameter(program, context.LINK_STATUS)) throw new Error(context.getProgramInfoLog(program) ?? 'link failed');
		const u: Record<string, WebGLUniformLocation | null> = {};
		const count = context.getProgramParameter(program, context.ACTIVE_UNIFORMS) as number;
		for (let index = 0; index < count; index++) {
			const info = context.getActiveUniform(program, index)!;
			u[info.name] = context.getUniformLocation(program, info.name);
		}
		return { program, u };
	}

	const programs = { blur: compile(BLUR), glass: compile(GLASS) };
	context.bindVertexArray(context.createVertexArray());

	function texture(mips: boolean): WebGLTexture {
		const tex = context.createTexture();
		context.bindTexture(context.TEXTURE_2D, tex);
		context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, mips ? context.LINEAR_MIPMAP_LINEAR : context.LINEAR);
		context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
		context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
		context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
		return tex;
	}

	function target(width: number, height: number, mips: boolean): Target {
		const tex = texture(mips);
		context.texImage2D(context.TEXTURE_2D, 0, context.RGBA8, width, height, 0, context.RGBA, context.UNSIGNED_BYTE, null);
		if (mips) context.generateMipmap(context.TEXTURE_2D);
		const fbo = context.createFramebuffer();
		context.bindFramebuffer(context.FRAMEBUFFER, fbo);
		context.framebufferTexture2D(context.FRAMEBUFFER, context.COLOR_ATTACHMENT0, context.TEXTURE_2D, tex, 0);
		return { tex, fbo, width, height };
	}

	function release(item: Target | null) {
		if (!item) return;
		context.deleteTexture(item.tex);
		context.deleteFramebuffer(item.fbo);
	}

	type Slot = {
		scene: WebGLTexture;
		size: [number, number];
		version: number;
		blur: { scale: number; h: Target; v: Target } | null;
		blurKey: string;
	};
	const slots: Slot[] = [];
	const slotAt = (index: number) => (slots[index] ??= { scene: texture(true), size: [1, 1], version: 0, blur: null, blurKey: '' });
	let width = 0;
	let height = 0;

	function resize(cssWidth: number, cssHeight: number, dpr: number) {
		width = Math.round(cssWidth * dpr);
		height = Math.round(cssHeight * dpr);
		canvas.width = width;
		canvas.height = height;
	}

	function releaseSlot(slot: Slot) {
		release(slot.blur?.h ?? null);
		release(slot.blur?.v ?? null);
		context.deleteTexture(slot.scene);
	}

	function keepSlots(count: number) {
		for (const slot of slots.splice(count)) releaseSlot(slot);
	}

	function setScene(source: HTMLCanvasElement, index = 0) {
		const slot = slotAt(index);
		context.bindTexture(context.TEXTURE_2D, slot.scene);
		context.pixelStorei(context.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
		context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, context.RGBA, context.UNSIGNED_BYTE, source);
		context.generateMipmap(context.TEXTURE_2D);
		slot.size = [source.width, source.height];
		slot.version += 1;
	}

	// Separable Gaussian (horizontal then vertical pass) on a downscaled copy, sampling mip levels
	// so a fixed 33-tap kernel covers large radii. Cached until the frost amount or scene changes.
	function blurred(slot: Slot, frost: number, dpr: number): WebGLTexture {
		const sigma = frost * dpr;
		const [sceneWidth, sceneHeight] = slot.size;
		const scale = sigma < RENDER.strongBlurFromPx ? RENDER.blurDownscale : RENDER.strongBlurDownscale;
		const w = Math.max(1, Math.ceil(sceneWidth / scale));
		const h = Math.max(1, Math.ceil(sceneHeight / scale));
		if (!slot.blur || slot.blur.scale !== scale || slot.blur.h.width !== w || slot.blur.h.height !== h) {
			release(slot.blur?.h ?? null);
			release(slot.blur?.v ?? null);
			slot.blur = { scale, h: target(w, h, true), v: target(w, h, true) };
			slot.blurKey = '';
		}
		const blur = slot.blur;
		const effective = Math.max(sigma, RENDER.minBlurPx * dpr);
		const key = `${effective}|${slot.version}`;
		if (key === slot.blurKey) return blur.v.tex;
		slot.blurKey = key;
		const stepPx = effective * RENDER.blurStepPerPx;
		const { program, u } = programs.blur;
		context.useProgram(program);
		context.activeTexture(context.TEXTURE0);
		context.uniform1i(u.uSrc, 0);
		context.viewport(0, 0, w, h);
		context.uniform2f(u.uDst, w, h);
		context.bindFramebuffer(context.FRAMEBUFFER, blur.h.fbo);
		context.bindTexture(context.TEXTURE_2D, slot.scene);
		context.uniform2f(u.uStep, stepPx / sceneWidth, 0);
		context.uniform1f(u.uLod, Math.log2(Math.max(stepPx, 1)));
		context.drawArrays(context.TRIANGLES, 0, 3);
		context.bindTexture(context.TEXTURE_2D, blur.h.tex);
		context.generateMipmap(context.TEXTURE_2D);
		context.bindFramebuffer(context.FRAMEBUFFER, blur.v.fbo);
		context.uniform2f(u.uStep, 0, stepPx / sceneHeight);
		context.uniform1f(u.uLod, Math.log2(Math.max(stepPx / scale, 1)));
		context.drawArrays(context.TRIANGLES, 0, 3);
		context.bindTexture(context.TEXTURE_2D, blur.v.tex);
		context.generateMipmap(context.TEXTURE_2D);
		return blur.v.tex;
	}

	function clear() {
		context.bindFramebuffer(context.FRAMEBUFFER, null);
		context.viewport(0, 0, width, height);
		context.clearColor(0, 0, 0, 0);
		context.clear(context.COLOR_BUFFER_BIT);
	}

	function render(params: GlassParams, shapes: GlassShape[], areas: Region[], region: Region, dpr: number, index = 0) {
		const slot = slotAt(index);
		// Blur radii are in pixels of the page copy, which can be lower resolution than the glass.
		const blurTex = blurred(slot, params.frost, slot.size[0] / region.width);
		const { program, u } = programs.glass;
		context.bindFramebuffer(context.FRAMEBUFFER, null);
		context.viewport(0, 0, width, height);
		context.useProgram(program);
		context.activeTexture(context.TEXTURE0);
		context.bindTexture(context.TEXTURE_2D, slot.scene);
		context.uniform1i(u.uScene, 0);
		context.activeTexture(context.TEXTURE1);
		context.bindTexture(context.TEXTURE_2D, blurTex);
		context.uniform1i(u.uBlur, 1);
		context.uniform2f(u.uRes, width, height);
		context.uniform4f(u.uRegion, region.x * dpr, region.y * dpr, region.width * dpr, region.height * dpr);
		context.uniform1f(u.uDpr, dpr);
		const shown = shapes.slice(0, MAX_SHAPES);
		context.uniform1i(u.uN, shown.length);
		if (shown.length) {
			context.uniform4fv(
				u['uRects[0]'],
				shown.flatMap((shape) => [
					(shape.x + shape.width / 2) * dpr,
					(shape.y + shape.height / 2) * dpr,
					(shape.width / 2) * dpr,
					(shape.height / 2) * dpr
				])
			);
			context.uniform2fv(
				u['uShape[0]'],
				shown.flatMap((shape) => [Math.min(shape.radius, shape.width / 2, shape.height / 2) * dpr, shape.alpha])
			);
		}
		context.uniform4f(u.uBounds, region.x * dpr, region.y * dpr, (region.x + region.width) * dpr, (region.y + region.height) * dpr);
		const light = lightVector(params);
		// Merging (blobby joins between nearby shapes) is a lab feature; the app's panels stay separate.
		context.uniform1f(u.uMerge, 0);
		context.uniform1f(u.uThick, params.thick * dpr);
		context.uniform1f(u.uIor, params.ior);
		context.uniform1f(u.uDisp, params.disp);
		context.uniform1f(u.uFrost, params.frost > 0.25 ? 1 : 0);
		context.uniform1f(u.uBevel, params.bevel * dpr);
		context.uniform1f(u.uLens, params.lens);
		context.uniform1f(u.uCurve, params.curve);
		context.uniform1f(u.uBody, params.body);
		context.uniform1f(u.uCut, params.cut);
		context.uniform1f(u.uStudio, params.studio);
		context.uniform1f(u.uFlip, params.flip);
		context.uniform3f(u.uLight, light[0], light[1], light[2]);
		context.uniform1f(u.uSpec, params.spec);
		context.uniform1f(u.uShin, RENDER.shininess);
		context.uniform1f(u.uRefl, params.refl);
		context.uniform1f(u.uIrid, params.irid);
		context.uniform1f(u.uRim, params.rim);
		context.uniform1f(u.uRimDir, params.rimDir);
		context.uniform1f(u.uShadow, params.shadow);
		context.uniform2f(u.uShadowOff, -light[3] * params.shadowDist * dpr, -light[4] * params.shadowDist * dpr);
		context.uniform1f(u.uShadowBlur, params.shadowBlur * dpr);
		context.uniform1f(u.uCaustic, params.caustic);
		context.uniform4f(u.uTint, TINT[0], TINT[1], TINT[2], params.tintA);
		context.uniform1f(u.uSat, params.sat);
		context.enable(context.SCISSOR_TEST);
		for (const area of areas) {
			const left = Math.round(area.x * dpr);
			const right = Math.min(width, Math.round((area.x + area.width) * dpr));
			const top = Math.round(area.y * dpr);
			const bottom = Math.min(height, Math.round((area.y + area.height) * dpr));
			if (right <= left || bottom <= top) continue;
			// GL's scissor origin is bottom-left, the DOM's is top-left.
			context.scissor(left, height - bottom, right - left, bottom - top);
			context.drawArrays(context.TRIANGLES, 0, 3);
		}
		context.disable(context.SCISSOR_TEST);
		context.activeTexture(context.TEXTURE0);
	}

	function dispose(loseContext: boolean) {
		keepSlots(0);
		for (const { program } of Object.values(programs)) context.deleteProgram(program);
		if (loseContext) context.getExtension('WEBGL_lose_context')?.loseContext();
	}

	return { resize, setScene, render, clear, keepSlots, dispose };
}

export type GlassRenderer = NonNullable<ReturnType<typeof createGlassRenderer>>;
