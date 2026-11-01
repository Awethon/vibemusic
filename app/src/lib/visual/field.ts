import { hexToRgb, hslToUnitRgb, relativeLuminance, rgbToHsl } from '../color.ts';
import type { AudioFeatures } from './analysis';

export type FieldRenderer = 'webgpu' | 'webgl2' | 'none';

export type FieldStyle = 'kick' | 'continuous';

export type FieldTuning = {
	gain: number;
	contrast: number;
	baseDisp: number;
	dispPerWave: number;
	loudFloor: number;
	kickAmp: number;
	hz: number;
	hzStep: number;
	spin: number;
	attack: number;
	release: number;
	kickAttack: number;
	kickRelease: number;
	shade: number;
	drift: number;
	driftLoud: number;
	calmTau: number;
	style: FieldStyle;
	hitAttack: number;
	hitRelease: number;
	hitGain: number;
	hitBassBias: number;
	hitHz: number;
};

export const FIELD_TUNING: Readonly<FieldTuning> = Object.freeze({
	gain: 1.0,
	contrast: 2,
	baseDisp: 0.012,
	dispPerWave: 0.11,
	loudFloor: 0.25,
	kickAmp: 0.3,
	hz: 0.7,
	hzStep: 1.17,
	spin: 0.012,
	attack: 0.12,
	release: 0.45,
	kickAttack: 0.06,
	kickRelease: 0.22,
	shade: 1.6,
	drift: 0.4,
	driftLoud: 0.5,
	calmTau: 2.5,
	style: 'kick',
	hitAttack: 0.015,
	hitRelease: 0.1,
	hitGain: 1.4,
	hitBassBias: 0.6,
	hitHz: 5
});

export const FIELD_RENDER_TUNING = Object.freeze({
	resolutionScale: 0.5,
	defaultPaletteRate: 1.2,
	defaultIntensity: 0.8,
	manualKickDecaySeconds: 0.15,
	reducedMotionDrift: 0.12,
	maxFrameSeconds: 0.1,
	defaultFrameSeconds: 0.016,
	modes: 8,
	firstModeWave: 0.32,
	modeWaveRatio: 0.756,
	modePhaseStep: 1.7,
	palette: Object.freeze({
		saturationGain: 1.5,
		saturationLift: 0.05,
		lightnessGain: 0.95,
		lightnessLift: 0.04,
		minLightness: 0.12,
		maxLightness: 0.5,
		maxLuminance: 0.2
	})
});

export type FieldFeatures = Pick<AudioFeatures, 'loudness' | 'intensity' | 'onset' | 'bass' | 'mid' | 'treble' | 'spectrum'>;

export type FieldFrameOptions = { intensity: number; ripples: number };

export type FieldPaletteOptions = { instant?: boolean; rate?: number };

export type FieldStats = {
	modes: Float32Array;
	displacement: Float32Array;
	kick: number;
	calm: number;
	reduced: boolean;
};

export type Field = {
	readonly renderer: FieldRenderer;
	readonly canvas: HTMLCanvasElement;
	readonly tune: FieldTuning;
	readonly stats: FieldStats;
	setPalette(colors: readonly string[], options?: FieldPaletteOptions): void;
	frame(nowMs: number, features: FieldFeatures | null, options: FieldFrameOptions): void;
	kick(strength?: number): void;
	resize(): void;
	destroy(): void;
};

const GLSL_VERTEX = `#version 300 es
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0.0,1.0);}`;

const GLSL_FRAGMENT = `#version 300 es
precision highp float;
uniform vec4 uA;
uniform vec4 uB;
uniform vec4 uC[5];
uniform vec4 uM[5];
out vec4 outColor;
float hs(vec2 q){uvec2 c=uvec2(ivec2(floor(q)));uint h=(c.x*0x8da6b343u)^(c.y*0xd8163841u);h^=h>>16u;h*=0x7feb352du;h^=h>>15u;h*=0x846ca68bu;h^=h>>16u;return float(h>>8u)*(1.0/16777216.0);}
float vn(vec2 p){vec2 i=floor(p);vec2 f=fract(p);vec2 u=f*f*(3.0-2.0*f);float a=hs(i);float b=hs(i+vec2(1.0,0.0));float c=hs(i+vec2(0.0,1.0));float d=hs(i+vec2(1.0,1.0));return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);}
float fbm(vec2 p){float v=0.0;float a=0.5;for(int i=0;i<5;i++){v+=a*vn(p);p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(3.1,1.7);a*=0.5;}return v;}
vec2 vib(vec2 x){
  vec2 d=vec2(0.0);
  for(int i=0;i<8;i++){
    float fi=float(i);
    float a=uM[i>>2][i&3];
    float ph=uM[2+(i>>2)][i&3];
    float k=19.635*pow(1.3228,fi);
    float base=fi*0.83+uM[4].x*(mod(fi,2.0)*2.0-1.0)/(1.0+0.5*fi);
    vec2 s=vec2(0.0);
    for(int j=0;j<3;j++){float fj=float(j);float an=base+fj*2.0943951;vec2 dir=vec2(cos(an),sin(an));s+=dir*sin(dot(dir,x)*k+fi*1.3+fj*2.7)*cos(ph+fj*2.1);}
    d+=s*a;
  }
  return d;
}
void main(){
  vec2 res=uA.xy;float t=uA.z;float en=uB.x;float inten=uB.w;
  vec2 fc=gl_FragCoord.xy;
  vec2 uv=fc/res;
  vec2 x=(fc-0.5*res)/res.y;
  vec2 g=vib(x);
  vec2 p=x*1.7+g;
  float s=t*0.035;
  vec2 q=vec2(fbm(p+vec2(0.0,s)),fbm(p+vec2(5.2,1.3)-s));
  float wa=2.2+0.5*en;
  vec2 r=vec2(fbm(p+wa*q+vec2(1.7,9.2)+0.6*s),fbm(p+wa*q+vec2(8.3,2.8)-0.5*s));
  float f=fbm(p+wa*r);
  vec3 col=mix(uC[1].rgb,uC[0].rgb,smoothstep(0.3,0.7,f));
  col=mix(col,uC[2].rgb,smoothstep(0.45,1.1,length(q)));
  col=mix(col,uC[3].rgb,smoothstep(0.55,0.85,r.x)*0.85);
  vec2 pw=p+(q-0.5)*1.1;
  float m=0.0;
  for(int i=0;i<4;i++){float fi=float(i);vec2 c=vec2(sin(s*1.7*(fi+1.0)+fi*2.1)*0.95,cos(s*1.3*(fi+1.4)+fi*1.3)*0.5);vec2 d=pw-c;m+=exp(-dot(d,d)*3.2);}
  col=mix(col,uC[4].rgb*1.35,smoothstep(0.3,1.25,m)*(0.4+0.25*inten));
  col*=0.42+0.95*smoothstep(0.2,0.85,f);
  col*=1.0+clamp(dot(g,vec2(-0.6,0.8))*uM[4].y,-0.06,0.06);
  float v=length((uv-0.5)*vec2(1.0,0.9));
  col*=mix(1.0,0.42,smoothstep(0.25,0.85,v));
  col*=0.55+0.45*inten;
  col+=(hs(fc+fract(t)*91.0)-0.5)*(2.0/255.0);
  outColor=vec4(col,1.0);
}`;

const WGSL = `
struct U { a: vec4f, b: vec4f, c: array<vec4f, 5>, m: array<vec4f, 5> };
@group(0) @binding(0) var<uniform> u: U;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}
fn hs(q: vec2f) -> f32 { let c = vec2u(vec2i(floor(q))); var h = (c.x * 0x8da6b343u) ^ (c.y * 0xd8163841u); h ^= h >> 16u; h *= 0x7feb352du; h ^= h >> 15u; h *= 0x846ca68bu; h ^= h >> 16u; return f32(h >> 8u) * (1.0 / 16777216.0); }
fn vn(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let w = f * f * (3.0 - 2.0 * f);
  let a = hs(i); let b = hs(i + vec2f(1.0, 0.0)); let c = hs(i + vec2f(0.0, 1.0)); let d = hs(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}
fn fbm(q: vec2f) -> f32 {
  var v = 0.0; var a = 0.5; var p = q;
  for (var i = 0; i < 5; i++) { v += a * vn(p); p = mat2x2f(1.6, 1.2, -1.2, 1.6) * p + vec2f(3.1, 1.7); a *= 0.5; }
  return v;
}
fn vib(x: vec2f) -> vec2f {
  var d = vec2f(0.0);
  for (var i = 0; i < 8; i++) {
    let fi = f32(i);
    let a = u.m[i / 4][i % 4];
    let ph = u.m[2 + i / 4][i % 4];
    let k = 19.635 * pow(1.3228, fi);
    let base = fi * 0.83 + u.m[4].x * (f32(i % 2) * 2.0 - 1.0) / (1.0 + 0.5 * fi);
    var s = vec2f(0.0);
    for (var j = 0; j < 3; j++) {
      let fj = f32(j);
      let an = base + fj * 2.0943951;
      let dir = vec2f(cos(an), sin(an));
      s += dir * sin(dot(dir, x) * k + fi * 1.3 + fj * 2.7) * cos(ph + fj * 2.1);
    }
    d += s * a;
  }
  return d;
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let res = u.a.xy; let t = u.a.z; let en = u.b.x; let inten = u.b.w;
  let fc = vec2f(pos.x, res.y - pos.y);
  let uv = fc / res;
  let x = (fc - 0.5 * res) / res.y;
  let g = vib(x);
  let p = x * 1.7 + g;
  let s = t * 0.035;
  let q = vec2f(fbm(p + vec2f(0.0, s)), fbm(p + vec2f(5.2, 1.3) - s));
  let wa = 2.2 + 0.5 * en;
  let r = vec2f(fbm(p + wa * q + vec2f(1.7, 9.2) + 0.6 * s), fbm(p + wa * q + vec2f(8.3, 2.8) - 0.5 * s));
  let f = fbm(p + wa * r);
  var col = mix(u.c[1].rgb, u.c[0].rgb, smoothstep(0.3, 0.7, f));
  col = mix(col, u.c[2].rgb, smoothstep(0.45, 1.1, length(q)));
  col = mix(col, u.c[3].rgb, smoothstep(0.55, 0.85, r.x) * 0.85);
  let pw = p + (q - 0.5) * 1.1;
  var m = 0.0;
  for (var i = 0; i < 4; i++) {
    let fi = f32(i);
    let c = vec2f(sin(s * 1.7 * (fi + 1.0) + fi * 2.1) * 0.95, cos(s * 1.3 * (fi + 1.4) + fi * 1.3) * 0.5);
    let d = pw - c;
    m += exp(-dot(d, d) * 3.2);
  }
  col = mix(col, u.c[4].rgb * 1.35, smoothstep(0.3, 1.25, m) * (0.4 + 0.25 * inten));
  col *= 0.42 + 0.95 * smoothstep(0.2, 0.85, f);
  col *= 1.0 + clamp(dot(g, vec2f(-0.6, 0.8)) * u.m[4].y, -0.06, 0.06);
  let v = length((uv - 0.5) * vec2f(1.0, 0.9));
  col *= mix(1.0, 0.42, smoothstep(0.25, 0.85, v));
  col *= 0.55 + 0.45 * inten;
  col += (hs(fc + fract(t) * 91.0) - 0.5) * (2.0 / 255.0);
  return vec4f(col, 1.0);
}`;

declare const GPUBufferUsage: { readonly UNIFORM: GPUBufferUsageFlags; readonly COPY_DST: GPUBufferUsageFlags };

type Backend = { draw(uniforms: Float32Array<ArrayBuffer>, width: number, height: number): void; destroy(): void };

function ease(previous: number, next: number, dt: number, up: number, down: number): number {
	return previous + (next - previous) * (1 - Math.exp(-dt / (next > previous ? up : down)));
}

function writePaletteColor(hex: string, out: Float32Array, offset: number) {
	const shaping = FIELD_RENDER_TUNING.palette;
	const [hue, saturation, lightness] = rgbToHsl(hexToRgb(hex));
	const vivid = Math.min(1, saturation * shaping.saturationGain + shaping.saturationLift);
	const level = Math.min(shaping.maxLightness, Math.max(shaping.minLightness, lightness * shaping.lightnessGain + shaping.lightnessLift));
	const rgb = hslToUnitRgb([hue, vivid, level]);
	const luminance = relativeLuminance(rgb);
	const scale = luminance > shaping.maxLuminance ? shaping.maxLuminance / luminance : 1;
	out[offset] = rgb[0] * scale;
	out[offset + 1] = rgb[1] * scale;
	out[offset + 2] = rgb[2] * scale;
}

async function createWebGpuBackend(canvas: HTMLCanvasElement): Promise<{ backend: Backend | null; touchedCanvas: boolean }> {
	if (!navigator.gpu) return { backend: null, touchedCanvas: false };
	let device: GPUDevice | null = null;
	let context: GPUCanvasContext | null = null;
	try {
		const adapter = await navigator.gpu.requestAdapter();
		if (!adapter) return { backend: null, touchedCanvas: false };
		device = await adapter.requestDevice();
		const module = device.createShaderModule({ code: WGSL });
		const info = await module.getCompilationInfo();
		if (info.messages.some((message) => message.type === 'error')) return { backend: null, touchedCanvas: true };
		context = canvas.getContext('webgpu') as GPUCanvasContext | null;
		if (!context) return { backend: null, touchedCanvas: true };
		const format = navigator.gpu.getPreferredCanvasFormat();
		context.configure({ device, format, alphaMode: 'opaque' });
		const pipeline = await device.createRenderPipelineAsync({
			layout: 'auto',
			vertex: { module, entryPoint: 'vs' },
			fragment: { module, entryPoint: 'fs', targets: [{ format }] },
			primitive: { topology: 'triangle-list' }
		});
		const uniformBuffer = device.createBuffer({
			size: 48 * Float32Array.BYTES_PER_ELEMENT,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});
		const bindGroup = device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
		});
		const readyDevice = device;
		const readyContext = context;
		let attachment: GPURenderPassColorAttachment | null = null;
		let passDescriptor: GPURenderPassDescriptor | null = null;
		const submits: GPUCommandBuffer[] = [];
		return {
			touchedCanvas: true,
			backend: {
				draw(uniforms) {
					readyDevice.queue.writeBuffer(uniformBuffer, 0, uniforms);
					const view = readyContext.getCurrentTexture().createView();
					if (attachment) attachment.view = view;
					else attachment = { view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } };
					passDescriptor ??= { colorAttachments: [attachment] };
					const encoder = readyDevice.createCommandEncoder();
					const pass = encoder.beginRenderPass(passDescriptor);
					pass.setPipeline(pipeline);
					pass.setBindGroup(0, bindGroup);
					pass.draw(3);
					pass.end();
					submits[0] = encoder.finish();
					readyDevice.queue.submit(submits);
				},
				destroy() {
					uniformBuffer.destroy();
					readyContext.unconfigure();
					readyDevice.destroy();
				}
			}
		};
	} catch {
		return { backend: null, touchedCanvas: context !== null || device !== null };
	} finally {
		if (device && !context) device.destroy();
	}
}

function createWebGl2Backend(canvas: HTMLCanvasElement): Backend | null {
	const gl = canvas.getContext('webgl2', {
		antialias: false,
		alpha: false,
		depth: false,
		stencil: false,
		preserveDrawingBuffer: false
	});
	if (!gl) return null;
	const compile = (type: GLenum, source: string): WebGLShader => {
		const shader = gl.createShader(type);
		if (!shader) throw new Error('createShader failed');
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'compile failed');
		return shader;
	};
	const program = gl.createProgram();
	gl.attachShader(program, compile(gl.VERTEX_SHADER, GLSL_VERTEX));
	gl.attachShader(program, compile(gl.FRAGMENT_SHADER, GLSL_FRAGMENT));
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link failed');
	gl.useProgram(program);
	const locationA = gl.getUniformLocation(program, 'uA');
	const locationB = gl.getUniformLocation(program, 'uB');
	const locationColors = gl.getUniformLocation(program, 'uC');
	const locationModes = gl.getUniformLocation(program, 'uM');
	const vertexArray = gl.createVertexArray();
	gl.bindVertexArray(vertexArray);
	return {
		draw(uniforms, width, height) {
			gl.viewport(0, 0, width, height);
			gl.uniform4fv(locationA, uniforms, 0, 4);
			gl.uniform4fv(locationB, uniforms, 4, 4);
			gl.uniform4fv(locationColors, uniforms, 8, 20);
			gl.uniform4fv(locationModes, uniforms, 28, 20);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
		},
		destroy() {
			gl.deleteVertexArray(vertexArray);
			gl.deleteProgram(program);
		}
	};
}

export async function createField(initialCanvas: HTMLCanvasElement, options: { renderer?: 'webgpu' | 'webgl2' } = {}): Promise<Field> {
	const render = FIELD_RENDER_TUNING;
	const modes = render.modes;
	const tune: FieldTuning = { ...FIELD_TUNING };
	const uniforms = new Float32Array(48);
	const currentColors = new Float32Array(15);
	const targetColors = new Float32Array(15);
	const displacement = new Float32Array(20);
	const envelope = new Float32Array(modes);
	const phase = new Float32Array(modes);
	const waveScale = new Float32Array(modes);
	for (let mode = 0; mode < modes; mode++) {
		waveScale[mode] = render.firstModeWave * Math.pow(render.modeWaveRatio, mode);
		phase[mode] = mode * render.modePhaseStep;
	}
	const tau = Math.PI * 2;
	let canvas = initialCanvas;
	let paletteRate: number = render.defaultPaletteRate;
	let width = 0;
	let height = 0;
	let time = 0;
	let lastFrameAt = 0;
	let calm = 0;
	let kick = 0;
	let manualKick = 0;
	let rotation = 0;

	const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
	let reduced = !!reducedQuery?.matches;
	const onReducedChange = (event: MediaQueryListEvent) => {
		reduced = event.matches;
	};
	reducedQuery?.addEventListener('change', onReducedChange);

	function resize() {
		const nextWidth = Math.max(2, Math.round(innerWidth * render.resolutionScale));
		const nextHeight = Math.max(2, Math.round(innerHeight * render.resolutionScale));
		if (nextWidth !== width || nextHeight !== height) {
			width = nextWidth;
			height = nextHeight;
			canvas.width = width;
			canvas.height = height;
		}
	}

	resize();
	let backend: Backend | null = null;
	let renderer: FieldRenderer = 'none';
	const webGpu = options.renderer !== 'webgl2' ? await createWebGpuBackend(canvas) : null;
	if (webGpu?.backend) {
		backend = webGpu.backend;
		renderer = 'webgpu';
	} else {
		if (webGpu?.touchedCanvas) {
			const fresh = canvas.cloneNode() as HTMLCanvasElement;
			canvas.replaceWith(fresh);
			canvas = fresh;
			width = height = 0;
			resize();
		}
		backend = createWebGl2Backend(canvas);
		renderer = backend ? 'webgl2' : 'none';
	}
	currentColors.set(targetColors);

	function modeLevel(features: FieldFeatures, mode: number): number {
		const spectrum = features.spectrum;
		if (spectrum && spectrum.length >= modes) {
			const perMode = spectrum.length / modes;
			const from = Math.floor(mode * perMode);
			const to = Math.floor((mode + 1) * perMode);
			let sum = 0;
			let peak = 0;
			for (let band = from; band < to; band++) {
				sum += spectrum[band];
				if (spectrum[band] > peak) peak = spectrum[band];
			}
			return 0.5 * (sum / (to - from)) + 0.5 * peak;
		}
		return mode < 3 ? features.bass || 0 : mode < 6 ? features.mid || 0 : features.treble || 0;
	}

	function draw(dt: number, energy: number, intensity: number) {
		if (!backend) return;
		resize();
		const blend = 1 - Math.exp(-dt * paletteRate);
		for (let index = 0; index < 15; index++) currentColors[index] += (targetColors[index] - currentColors[index]) * blend;
		uniforms[0] = width;
		uniforms[1] = height;
		uniforms[2] = time;
		uniforms[3] = 0;
		uniforms[4] = energy;
		uniforms[5] = 0.5;
		uniforms[6] = 0.5;
		uniforms[7] = intensity;
		for (let color = 0; color < 5; color++) {
			uniforms[8 + color * 4] = currentColors[color * 3];
			uniforms[9 + color * 4] = currentColors[color * 3 + 1];
			uniforms[10 + color * 4] = currentColors[color * 3 + 2];
			uniforms[11 + color * 4] = 1;
		}
		for (let index = 0; index < 20; index++) uniforms[28 + index] = displacement[index];
		backend.draw(uniforms, width, height);
	}

	return {
		get renderer() {
			return renderer;
		},
		get canvas() {
			return canvas;
		},
		tune,
		get stats() {
			return { modes: envelope, displacement, kick, calm, reduced };
		},
		setPalette(colors, paletteOptions = {}) {
			for (let color = 0; color < 5; color++) writePaletteColor(colors[color] || colors[0], targetColors, color * 3);
			paletteRate = paletteOptions.rate ?? render.defaultPaletteRate;
			if (paletteOptions.instant) currentColors.set(targetColors);
		},
		kick(strength = 1) {
			manualKick = Math.max(manualKick, Math.min(1, strength));
		},
		frame(nowMs, features, frameOptions) {
			const dt = Math.min(render.maxFrameSeconds, lastFrameAt ? Math.max(0, nowMs - lastFrameAt) / 1000 : render.defaultFrameSeconds);
			lastFrameAt = nowMs;
			const absolute = features ? Math.min(1, Math.max(0, features.loudness || 0)) : 0;
			const relative = features?.intensity ?? absolute;
			const loud = Math.min(1, Math.max(0, relative * (0.3 + 0.7 * absolute)));
			calm += (loud - calm) * (1 - Math.exp(-dt / tune.calmTau));
			time += dt * (reduced ? render.reducedMotionDrift : tune.drift + tune.driftLoud * calm);
			const amount = reduced ? 0 : Math.max(0, frameOptions.ripples ?? 1);
			const rawOnset = features ? Math.min(1, features.onset || 0) : 0;
			const hits = tune.style === 'kick';
			const onset = hits ? rawOnset : rawOnset * (0.3 + 0.7 * loud);
			kick = hits ? Math.max(onset, manualKick) : ease(kick, Math.max(onset, manualKick), dt, tune.kickAttack, tune.kickRelease);
			manualKick *= Math.exp(-dt / render.manualKickDecaySeconds);
			const weight = loud * (tune.loudFloor + (1 - tune.loudFloor) * loud);
			const boost = hits ? 1 : 1 + tune.kickAmp * kick;
			const hit = Math.min(1, kick * tune.hitGain);
			for (let mode = 0; mode < modes; mode++) {
				const level = features ? Math.min(1, modeLevel(features, mode)) : 0;
				const bassWeight = 1 - (tune.hitBassBias * mode) / (modes - 1);
				const target = hits ? bassWeight * hit : Math.pow(level, tune.contrast) * weight;
				envelope[mode] = hits
					? ease(envelope[mode], target, dt, tune.hitAttack, tune.hitRelease)
					: ease(envelope[mode], target, dt, tune.attack, tune.release);
				const hz = hits ? tune.hitHz * Math.pow(tune.hzStep, mode * 0.5) : tune.hz * Math.pow(tune.hzStep, mode);
				phase[mode] = (phase[mode] + dt * tau * hz) % tau;
				displacement[mode] =
					tune.gain * (tune.baseDisp + tune.dispPerWave * waveScale[mode]) * Math.min(1, envelope[mode] * boost) * amount;
				displacement[8 + mode] = phase[mode];
			}
			rotation += dt * tune.spin;
			displacement[16] = rotation;
			displacement[17] = tune.shade;
			displacement[18] = 0;
			displacement[19] = 0;
			draw(dt, calm, frameOptions.intensity ?? render.defaultIntensity);
		},
		resize,
		destroy() {
			reducedQuery?.removeEventListener('change', onReducedChange);
			backend?.destroy();
			backend = null;
			renderer = 'none';
		}
	};
}
