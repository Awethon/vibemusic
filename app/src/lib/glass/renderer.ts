import { lightVector, type GlassParams } from './params.ts';
import { BLUR, GLASS, MAX_SHAPES, VERT } from './shaders.ts';

export type GlassShape = { x: number; y: number; width: number; height: number; radius: number; alpha: number };
export type Region = { x: number; y: number; width: number; height: number };

type Target = { tex: WebGLTexture; fbo: WebGLFramebuffer; width: number; height: number };
type Program = { program: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };

const TINT: [number, number, number] = [0.04, 0.045, 0.06];

export function createGlassRenderer(canvas: HTMLCanvasElement) {
	const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true, depth: false, stencil: false });
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

	const scene = texture(true);
	let sceneSize = [1, 1];
	let blur: { scale: number; h: Target; v: Target } | null = null;
	let blurKey = '';
	let sceneVersion = 0;
	let width = 0;
	let height = 0;

	function resize(cssWidth: number, cssHeight: number, dpr: number) {
		width = Math.round(cssWidth * dpr);
		height = Math.round(cssHeight * dpr);
		canvas.width = width;
		canvas.height = height;
	}

	function setScene(source: HTMLCanvasElement) {
		context.bindTexture(context.TEXTURE_2D, scene);
		context.pixelStorei(context.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
		context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, context.RGBA, context.UNSIGNED_BYTE, source);
		context.generateMipmap(context.TEXTURE_2D);
		sceneSize = [source.width, source.height];
		sceneVersion += 1;
	}

	function blurred(frost: number, dpr: number): WebGLTexture {
		const sigma = frost * dpr;
		const [sceneWidth, sceneHeight] = sceneSize;
		const scale = sigma < 14 ? 2 : 4;
		const w = Math.max(1, Math.ceil(sceneWidth / scale));
		const h = Math.max(1, Math.ceil(sceneHeight / scale));
		if (!blur || blur.scale !== scale || blur.h.width !== w || blur.h.height !== h) {
			release(blur?.h ?? null);
			release(blur?.v ?? null);
			blur = { scale, h: target(w, h, true), v: target(w, h, true) };
			blurKey = '';
		}
		const effective = Math.max(sigma, 6 * dpr);
		const key = `${effective}|${sceneVersion}`;
		if (key === blurKey) return blur.v.tex;
		blurKey = key;
		const stepPx = (3 * effective) / 16;
		const { program, u } = programs.blur;
		context.useProgram(program);
		context.activeTexture(context.TEXTURE0);
		context.uniform1i(u.uSrc, 0);
		context.viewport(0, 0, w, h);
		context.uniform2f(u.uDst, w, h);
		context.bindFramebuffer(context.FRAMEBUFFER, blur.h.fbo);
		context.bindTexture(context.TEXTURE_2D, scene);
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

	function render(params: GlassParams, shapes: GlassShape[], region: Region, bounds: Region, dpr: number) {
		const blurTex = blurred(params.frost, dpr);
		const { program, u } = programs.glass;
		clear();
		context.useProgram(program);
		context.activeTexture(context.TEXTURE0);
		context.bindTexture(context.TEXTURE_2D, scene);
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
				shown.flatMap((shape) => [(shape.x + shape.width / 2) * dpr, (shape.y + shape.height / 2) * dpr, (shape.width / 2) * dpr, (shape.height / 2) * dpr])
			);
			context.uniform2fv(
				u['uShape[0]'],
				shown.flatMap((shape) => [Math.min(shape.radius, shape.width / 2, shape.height / 2) * dpr, shape.alpha])
			);
		}
		context.uniform4f(u.uBounds, bounds.x * dpr, bounds.y * dpr, (bounds.x + bounds.width) * dpr, (bounds.y + bounds.height) * dpr);
		const light = lightVector(params);
		context.uniform1f(u.uMerge, params.merge * dpr);
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
		context.uniform1f(u.uShin, 60);
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
		context.drawArrays(context.TRIANGLES, 0, 3);
		context.activeTexture(context.TEXTURE0);
	}

	function dispose() {
		release(blur?.h ?? null);
		release(blur?.v ?? null);
		context.deleteTexture(scene);
		context.getExtension('WEBGL_lose_context')?.loseContext();
	}

	return { resize, setScene, render, clear, dispose };
}

export type GlassRenderer = NonNullable<ReturnType<typeof createGlassRenderer>>;
