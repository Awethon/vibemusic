// "Amber": the second background. Light passes through a moving liquid surface onto a dark stone
// floor, focusing into caustic lines and knots, tinted by the album's accents. It's physically
// based: a grid of light rays is refracted by the surface's slope and each triangle lands with
// brightness = source area / landed area. Drawn once per RGB channel with slightly different
// refraction, which gives the colour fringes (dispersion). It doesn't react to the music: the
// surface keeps its own slow motion. WebGL2 only (needs float render targets).
//
// Frame pipeline: surface slope (one texel per grid point) → light mesh, 3 passes, 4x MSAA →
// floor and tint noise at quarter resolution → composite.
import { hexToRgb, oklabToLinear, rgbToOklab, type Oklab } from '../color.ts';
import type { BackgroundRenderer, FieldFeatures, FieldFrameOptions, FieldPaletteOptions } from './field.ts';

export const AMBER_TUNING = Object.freeze({
	// Grid rows per pixel of height. Coarser grids show their triangles along the lines; finer ones
	// make pixel-sized triangles, which GPUs draw slowly (one row per 2 px cost twice as much).
	rowPx: 3,
	minRows: 120,
	maxRows: 600,
	// Anti-aliasing for the light: fold lines are triangle edges with very high brightness and
	// come out as a staircase of coloured dots without it.
	samples: 4,
	// The floor and tint noise is low-frequency and computed at 1/fieldScale resolution.
	fieldScale: 4,
	maxPixelRatio: 2,
	// Caps the canvas size on large screens, in pixels.
	maxPixels: 4_000_000,
	// Red refracts least, blue most.
	dispersion: Object.freeze([0.965, 1, 1.04]),
	// The surface is already well developed at this time; earlier it looks too regular.
	startSeconds: 120,
	defaultPaletteRate: 1.2,
	maxFrameSeconds: 0.1
});

// ---- colour roles --------------------------------------------------------------------------------
// The album palette becomes five roles: ground, body dark, body light, accent 2, accent 1. Each
// role's lightness is mapped into a fixed band, so the result is always dark enough; hue is kept.
const ROLE_LIGHTNESS = [
	[0.1, 0.18],
	[0.2, 0.3],
	[0.3, 0.42],
	[0.45, 0.58],
	[0.55, 0.7]
] as const;

function inGamut(lab: Oklab) {
	return oklabToLinear(lab).every((channel) => channel >= -1e-4 && channel <= 1 + 1e-4);
}

// Lowers chroma (keeping lightness and hue) until the colour fits in sRGB.
function clampToGamut([L, a, b]: Oklab): Oklab {
	if (inGamut([L, a, b])) return [L, a, b];
	let low = 0;
	let high = 1;
	for (let i = 0; i < 18; i++) {
		const middle = (low + high) / 2;
		if (inGamut([L, a * middle, b * middle])) low = middle;
		else high = middle;
	}
	return [L, a * low, b * low];
}

function shapeRole([L, a, b]: Oklab, role: number): Oklab {
	const [low, high] = ROLE_LIGHTNESS[role];
	const nextL = low + (high - low) * Math.min(1, Math.max(0, L));
	// Near-blacks have no trustworthy hue; raising their lightness would invent a cast.
	if (L < 0.06) return [nextL, 0, 0];
	// Darkening at constant chroma turns cream into olive; shrinking chroma keeps it a warm dark.
	const scale = nextL < L ? (nextL / L) ** 0.6 : 1;
	return clampToGamut([nextL, a * scale, b * scale]);
}

function roles(colors: readonly string[]): Oklab[] {
	const source = colors.length ? colors : ['#30283a'];
	const pool = Array.from({ length: 5 }, (_, i) => {
		const lab = rgbToOklab(hexToRgb(source[i % source.length]));
		return { lab, chroma: Math.hypot(lab[1], lab[2]) };
	});
	const takeBest = (score: (entry: (typeof pool)[number]) => number) => {
		let best = 0;
		pool.forEach((entry, i) => {
			if (score(entry) > score(pool[best])) best = i;
		});
		return pool.splice(best, 1)[0];
	};
	// Accents: most colourful first, brightness breaks ties.
	const accentScore = (entry: (typeof pool)[number]) => entry.chroma * 4 + entry.lab[0] * 0.25;
	const accent1 = takeBest(accentScore);
	const accent2 = takeBest(accentScore);
	const ground = takeBest((entry) => -entry.lab[0]);
	const [bodyDark, bodyLight] = pool.toSorted((x, y) => x.lab[0] - y.lab[0]);
	return [ground, bodyDark, bodyLight, accent2, accent1].map((entry, role) => shapeRole(entry.lab, role));
}

// ---- shaders -------------------------------------------------------------------------------------
const HEADER = `#version 300 es
precision highp float;
precision highp int;
`;

const COMMON = `
const float TAU=6.28318530718;
float hash12(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
vec3 hash33(vec3 p){p=fract(p*vec3(.1031,.1030,.0973));p+=dot(p,p.yxz+33.33);return fract((p.xxy+p.yxx)*p.zyx)*2.-1.;}
// Gradient noise, roughly in [-0.7, 0.7].
float gnoise(vec3 p){
  vec3 i=floor(p),f=fract(p);vec3 u=f*f*f*(f*(f*6.-15.)+10.);
  float a=dot(hash33(i),f),b=dot(hash33(i+vec3(1,0,0)),f-vec3(1,0,0)),c=dot(hash33(i+vec3(0,1,0)),f-vec3(0,1,0)),d=dot(hash33(i+vec3(1,1,0)),f-vec3(1,1,0));
  float e=dot(hash33(i+vec3(0,0,1)),f-vec3(0,0,1)),g=dot(hash33(i+vec3(1,0,1)),f-vec3(1,0,1)),h=dot(hash33(i+vec3(0,1,1)),f-vec3(0,1,1)),k=dot(hash33(i+vec3(1,1,1)),f-vec3(1,1,1));
  return mix(mix(mix(a,b,u.x),mix(c,d,u.x),u.y),mix(mix(e,g,u.x),mix(h,k,u.x),u.y),u.z);
}
float fbm(vec3 p,int octaves){float s=0.,a=.5;for(int i=0;i<6;i++){if(i>=octaves)break;s+=a*gnoise(p);p=p*2.02+vec3(17.1,3.7,9.3);a*=.5;}return s;}
vec3 labToLin(vec3 c){
  float l=c.x+.3963377774*c.y+.2158037573*c.z,m=c.x-.1055613458*c.y-.0638541728*c.z,s=c.x-.0894841775*c.y-1.2914855480*c.z;
  l=l*l*l;m=m*m*m;s=s*s*s;
  return vec3(4.0767416621*l-3.3077115913*m+.2309699292*s,-1.2684380046*l+2.6097574011*m-.3413193965*s,-.0041960863*l-.7034186147*m+1.7076147010*s);
}
// Same hue, new lightness; chroma shrinks when darkening so it stays in gamut.
vec3 withL(vec3 lab,float L){float k=min(1.,L/max(lab.x,1e-3)*1.25);return vec3(L,lab.yz*k);}
`;

const GRID_POINT = `
vec2 gridToSurface(vec2 g,ivec2 grid,vec2 res){
  vec2 uv=g/vec2(grid)*1.3-.15;
  return (uv-.5)*vec2(res.x/res.y,1.);
}`;

const FULLSCREEN = HEADER + `void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`;

// Liquid surface: dispersive waves (speed ~ sqrt k, like real water, slowed down) with amplitudes
// ~ 1/k^2 so every wave contributes the same curvature. Its slope is computed once per frame into
// a texture with one texel per grid point; the three light passes only read it.
const SLOPE_FRAGMENT =
	HEADER +
	COMMON +
	GRID_POINT +
	`
uniform vec2 u_res;
uniform float u_time;
uniform ivec2 u_grid;
out vec4 o;
float heightAt(vec2 p,float t){
  float h=0.;
  for(int i=0;i<7;i++){
    float fi=float(i);
    float k=TAU*1.3*pow(1.24,fi);
    float angle=fi*2.39996+.3;
    h+=(.42/(k*k))*sin(dot(vec2(cos(angle),sin(angle)),p)*k-.11*sqrt(k)*t+fi*1.7);
  }
  return h+.0022*gnoise(vec3(p*3.,t*.06))+.0008*gnoise(vec3(p*7.,t*.09+3.));
}
void main(){
  vec2 p=gridToSurface(floor(gl_FragCoord.xy),u_grid,u_res);
  float e=.0015;
  o=vec4(vec2(heightAt(p+vec2(e,0),u_time)-heightAt(p-vec2(e,0),u_time),heightAt(p+vec2(0,e),u_time)-heightAt(p-vec2(0,e),u_time))/(2.*e),0.,1.);
}`;

// One vertex per grid point (indexed mesh), refracted onto the floor (paraxial approximation).
const LIGHT_VERTEX =
	HEADER +
	GRID_POINT +
	`
uniform vec2 u_res;
uniform float u_dispersion;
uniform ivec2 u_grid;
uniform sampler2D u_slope;
out vec2 v_source;
void main(){
  ivec2 g=ivec2(gl_VertexID%(u_grid.x+1),gl_VertexID/(u_grid.x+1));
  vec2 p=gridToSurface(vec2(g),u_grid,u_res);
  vec2 slope=texelFetch(u_slope,g,0).xy;
  vec2 landed=p-u_dispersion*slope;
  v_source=p;
  gl_Position=vec4(landed/vec2(u_res.x/u_res.y,1.)*2.,0.,1.);
}`;

// Brightness = source area / landed area (inverse Jacobian). Overlapping folds add up.
const LIGHT_FRAGMENT =
	HEADER +
	`
uniform vec2 u_res;
in vec2 v_source;
out vec4 o;
void main(){
  vec2 dx=dFdx(v_source),dy=dFdy(v_source);
  o=vec4(min(abs(dx.x*dy.y-dx.y*dy.x)*u_res.y*u_res.y,48.));
}`;

// Stone texture of the floor (r), accent mix (g) and liquid depth (b), all low-frequency.
const FIELD_FRAGMENT =
	HEADER +
	COMMON +
	`
uniform vec2 u_res;
uniform vec2 u_fieldSize;
uniform float u_time;
out vec4 o;
void main(){
  vec2 p=(gl_FragCoord.xy/u_fieldSize-.5)*vec2(u_res.x/u_res.y,1.);
  float t=u_time;
  o=vec4(fbm(vec3(p*5.,1.),4),.5+.5*gnoise(vec3(p*.7,t*.025)),1.+.4*gnoise(vec3(p*1.3+4.,t*.03)),1.);
}`;

const COMPOSITE_FRAGMENT =
	HEADER +
	COMMON +
	`
uniform vec2 u_res;
uniform float u_ktime;
uniform vec3 u_lab[5];
uniform sampler2D u_light;
uniform sampler2D u_field;
out vec4 fragColor;
vec3 linToSrgb(vec3 c){c=clamp(c,0.,1.);return mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,step(.0031308,c));}
void main(){
  vec2 uv=gl_FragCoord.xy/u_res,px=1./u_res;
  // Soften: finite sun size, a slightly rough floor, the mesh's triangle edges rounded off.
  vec3 I=vec3(0.);
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    float w=(x==0?.5:.25)*(y==0?.5:.25);
    I+=texture(u_light,uv+vec2(x,y)*px*1.25).rgb*w;
  }
  vec3 field=texture(u_field,uv).rgb;
  vec3 floorLin=labToLin(withL(u_lab[0],clamp(u_lab[0].x,.09,.14)*(1.+.25*field.r)));
  // White light filtered by the liquid (Beer–Lambert): the tint deepens where it's deeper.
  vec3 tint=max(labToLin(mix(u_lab[4],u_lab[3],field.g)),vec3(1e-3));
  vec3 col=floorLin*.9+pow(tint,vec3(field.b))*I*.075;
  col=col*(1.+col/4.)/(1.+col);
  vec3 s=linToSrgb(col);
  s+=(hash12(gl_FragCoord.xy+fract(u_ktime)*91.7)-.5)/255.;
  fragColor=vec4(s,1.);
}`;

type Program = { program: WebGLProgram; at(name: string): WebGLUniformLocation | null };

function createProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string): Program {
	const compile = (type: number, source: string) => {
		const shader = gl.createShader(type)!;
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'amber: shader failed');
		return shader;
	};
	const program = gl.createProgram()!;
	gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
	gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'amber: link failed');
	const locations = new Map<string, WebGLUniformLocation | null>();
	return {
		program,
		at(name) {
			if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
			return locations.get(name)!;
		}
	};
}

type Target = { texture: WebGLTexture; framebuffer: WebGLFramebuffer; key: string };

function createTarget(gl: WebGL2RenderingContext): Target {
	return { texture: gl.createTexture()!, framebuffer: gl.createFramebuffer()!, key: '' };
}

function sizeTarget(
	gl: WebGL2RenderingContext,
	target: Target,
	width: number,
	height: number,
	format: number,
	type: number,
	filter: number
) {
	const key = `${width}x${height}`;
	if (target.key === key) return;
	target.key = key;
	gl.bindTexture(gl.TEXTURE_2D, target.texture);
	gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, format === gl.RG32F ? gl.RG : gl.RGBA, type, null);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);
}

export async function createAmber(canvas: HTMLCanvasElement): Promise<BackgroundRenderer> {
	const tune = AMBER_TUNING;
	const context = canvas.getContext('webgl2', {
		alpha: false,
		antialias: false,
		depth: false,
		stencil: false,
		preserveDrawingBuffer: false
	});
	if (!context) throw new Error('amber: WebGL2 unavailable');
	const gl: WebGL2RenderingContext = context;
	// Float targets hold the light's very high brightness at folds; the slope needs 32-bit
	// precision, since caustics amplify tiny slope errors into visible noise.
	if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('amber: float render targets unavailable');

	const slopeProgram = createProgram(gl, FULLSCREEN, SLOPE_FRAGMENT);
	const lightProgram = createProgram(gl, LIGHT_VERTEX, LIGHT_FRAGMENT);
	const fieldProgram = createProgram(gl, FULLSCREEN, FIELD_FRAGMENT);
	const compositeProgram = createProgram(gl, FULLSCREEN, COMPOSITE_FRAGMENT);
	const vertexArray = gl.createVertexArray()!;
	const indexBuffer = gl.createBuffer()!;
	const slope = createTarget(gl);
	const light = createTarget(gl);
	const field = createTarget(gl);
	const multisample = { renderbuffer: gl.createRenderbuffer()!, framebuffer: gl.createFramebuffer()!, key: '' };
	const samples = Math.min(tune.samples, gl.getParameter(gl.MAX_SAMPLES) as number);
	let gridKey = '';
	let indexCount = 0;

	function buildGrid(columns: number, rows: number) {
		const key = `${columns}x${rows}`;
		if (key === gridKey) return;
		gridKey = key;
		const indices = new Uint32Array(columns * rows * 6);
		for (let row = 0, i = 0; row < rows; row++)
			for (let column = 0; column < columns; column++) {
				const a = row * (columns + 1) + column;
				const below = a + columns + 1;
				indices.set([a, a + 1, below, below, a + 1, below + 1], i);
				i += 6;
			}
		gl.bindVertexArray(vertexArray);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
		indexCount = indices.length;
	}

	function sizeMultisample(width: number, height: number) {
		const key = `${width}x${height}`;
		if (multisample.key === key) return;
		multisample.key = key;
		gl.bindRenderbuffer(gl.RENDERBUFFER, multisample.renderbuffer);
		gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA16F, width, height);
		gl.bindFramebuffer(gl.FRAMEBUFFER, multisample.framebuffer);
		gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, multisample.renderbuffer);
	}

	// ---- state ----
	let width = 0;
	let height = 0;
	let lastFrameAt = 0;
	let time = tune.startSeconds;
	const shown: Oklab[] = roles([]);
	let target: Oklab[] = shown.map((lab) => [...lab] as Oklab);
	let paletteRate: number = tune.defaultPaletteRate;
	const labUniform = new Float32Array(15);

	function resize() {
		const ratio = Math.min(devicePixelRatio || 1, tune.maxPixelRatio);
		let nextWidth = innerWidth * ratio;
		let nextHeight = innerHeight * ratio;
		const pixels = nextWidth * nextHeight;
		if (pixels > tune.maxPixels) {
			const scale = Math.sqrt(tune.maxPixels / pixels);
			nextWidth *= scale;
			nextHeight *= scale;
		}
		width = Math.max(2, Math.round(nextWidth));
		height = Math.max(2, Math.round(nextHeight));
		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width;
			canvas.height = height;
		}
	}
	resize();

	function draw(nowMs: number) {
		const ktime = (nowMs / 1000) % 1000;
		const rows = Math.max(tune.minRows, Math.min(tune.maxRows, Math.round(height / tune.rowPx)));
		const columns = Math.round((rows * width) / height);
		buildGrid(columns, rows);
		gl.bindVertexArray(vertexArray);

		sizeTarget(gl, slope, columns + 1, rows + 1, gl.RG32F, gl.FLOAT, gl.NEAREST);
		gl.bindFramebuffer(gl.FRAMEBUFFER, slope.framebuffer);
		gl.viewport(0, 0, columns + 1, rows + 1);
		gl.useProgram(slopeProgram.program);
		gl.uniform2f(slopeProgram.at('u_res'), width, height);
		gl.uniform1f(slopeProgram.at('u_time'), time);
		gl.uniform2i(slopeProgram.at('u_grid'), columns, rows);
		gl.drawArrays(gl.TRIANGLES, 0, 3);

		sizeTarget(gl, light, width, height, gl.RGBA16F, gl.HALF_FLOAT, gl.LINEAR);
		sizeMultisample(width, height);
		gl.bindFramebuffer(gl.FRAMEBUFFER, multisample.framebuffer);
		gl.viewport(0, 0, width, height);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.useProgram(lightProgram.program);
		gl.uniform2f(lightProgram.at('u_res'), width, height);
		gl.uniform2i(lightProgram.at('u_grid'), columns, rows);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, slope.texture);
		gl.uniform1i(lightProgram.at('u_slope'), 0);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE);
		tune.dispersion.forEach((dispersion, channel) => {
			gl.colorMask(channel === 0, channel === 1, channel === 2, false);
			gl.uniform1f(lightProgram.at('u_dispersion'), dispersion);
			gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0);
		});
		gl.colorMask(true, true, true, true);
		gl.disable(gl.BLEND);
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, multisample.framebuffer);
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, light.framebuffer);
		gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);

		const fieldWidth = Math.max(1, Math.round(width / tune.fieldScale));
		const fieldHeight = Math.max(1, Math.round(height / tune.fieldScale));
		sizeTarget(gl, field, fieldWidth, fieldHeight, gl.RGBA16F, gl.HALF_FLOAT, gl.LINEAR);
		gl.bindFramebuffer(gl.FRAMEBUFFER, field.framebuffer);
		gl.viewport(0, 0, fieldWidth, fieldHeight);
		gl.useProgram(fieldProgram.program);
		gl.uniform2f(fieldProgram.at('u_res'), width, height);
		gl.uniform2f(fieldProgram.at('u_fieldSize'), fieldWidth, fieldHeight);
		gl.uniform1f(fieldProgram.at('u_time'), time);
		gl.drawArrays(gl.TRIANGLES, 0, 3);

		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, width, height);
		gl.useProgram(compositeProgram.program);
		gl.uniform2f(compositeProgram.at('u_res'), width, height);
		gl.uniform1f(compositeProgram.at('u_ktime'), ktime);
		shown.forEach((lab, role) => labUniform.set(lab, role * 3));
		gl.uniform3fv(compositeProgram.at('u_lab'), labUniform);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, light.texture);
		gl.uniform1i(compositeProgram.at('u_light'), 0);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, field.texture);
		gl.uniform1i(compositeProgram.at('u_field'), 1);
		gl.activeTexture(gl.TEXTURE0);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	}

	return {
		renderer: 'webgl2',
		canvas,
		setPalette(colors: readonly string[], options: FieldPaletteOptions = {}) {
			target = roles(colors);
			paletteRate = options.rate ?? tune.defaultPaletteRate;
			if (options.instant) target.forEach((lab, role) => (shown[role] = [...lab] as Oklab));
		},
		// Music doesn't move the caustics.
		kick() {},
		frame(nowMs: number, _features: FieldFeatures | null, _options: FieldFrameOptions) {
			const dt = lastFrameAt ? Math.min(tune.maxFrameSeconds, Math.max(0, (nowMs - lastFrameAt) / 1000)) : 0;
			lastFrameAt = nowMs;
			time += dt;
			const blend = 1 - Math.exp(-dt * paletteRate);
			shown.forEach((lab, role) => lab.forEach((value, k) => (lab[k] = value + (target[role][k] - value) * blend)));
			draw(nowMs);
		},
		resize,
		destroy() {
			for (const p of [slopeProgram, lightProgram, fieldProgram, compositeProgram]) gl.deleteProgram(p.program);
			for (const t of [slope, light, field]) {
				gl.deleteTexture(t.texture);
				gl.deleteFramebuffer(t.framebuffer);
			}
			gl.deleteRenderbuffer(multisample.renderbuffer);
			gl.deleteFramebuffer(multisample.framebuffer);
			gl.deleteBuffer(indexBuffer);
			gl.deleteVertexArray(vertexArray);
		}
	};
}
