// GLSL for the glass: a separable blur pass, and the glass pass, which turns the shapes' signed
// distance field into a height field, takes normals from its gradient and offsets the backdrop
// lookup by refraction, then adds Fresnel reflection, specular, rim light, iridescence and a shadow.
// MAX_SHAPES sizes the uniform arrays; the renderer ignores shapes beyond it.
export const MAX_SHAPES = 8;

// One oversized triangle covers the whole viewport; no vertex buffer needed.
export const VERT = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() { gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }`;

export const BLUR = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uDst;
uniform vec2 uStep;
uniform float uLod;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / uDst;
  vec3 a = vec3(0.0);
  float ws = 0.0;
  for (int i = -16; i <= 16; i++) {
    float x = float(i);
    float w = exp(-x * x / 56.9);
    a += textureLod(uSrc, uv + uStep * x, uLod).rgb * w;
    ws += w;
  }
  o = vec4(a / ws, 1.0);
}`;

export const GLASS = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBlur;
uniform vec2 uRes;
uniform vec4 uRegion;
uniform float uDpr;
uniform int uN;
uniform vec4 uRects[${MAX_SHAPES}];
uniform vec2 uShape[${MAX_SHAPES}];
uniform vec4 uBounds;
uniform float uMerge;
uniform float uThick;
uniform float uIor;
uniform float uDisp;
uniform float uFrost;
uniform float uBevel;
uniform float uLens;
uniform float uCurve;
uniform float uBody;
uniform float uCut;
uniform float uStudio;
uniform float uFlip;
uniform vec3 uLight;
uniform float uSpec;
uniform float uShin;
uniform float uRefl;
uniform float uIrid;
uniform float uRim;
uniform float uRimDir;
uniform float uShadow;
uniform vec2 uShadowOff;
uniform float uShadowBlur;
uniform float uCaustic;
uniform vec4 uTint;
uniform float uSat;
out vec4 o;

float sdRound(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float smin(float a, float b, float k) {
  if (k <= 0.0) return min(a, b);
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

float shapeDist(int i, vec2 p) {
  return sdRound(p - uRects[i].xy, uRects[i].zw, uShape[i].x);
}

float sdf(vec2 p) {
  float d = 1e5;
  for (int i = 0; i < ${MAX_SHAPES}; i++) {
    if (i >= uN) break;
    float c = shapeDist(i, p);
    d = d > 1e4 ? c : smin(d, c, uMerge);
  }
  return d;
}

float alphaAt(vec2 p) {
  float k = max(uMerge * 0.25, uDpr);
  float ws = 0.0;
  float acc = 0.0;
  for (int i = 0; i < ${MAX_SHAPES}; i++) {
    if (i >= uN) break;
    float w = exp(-max(shapeDist(i, p), -k * 8.0) / k);
    ws += w;
    acc += w * uShape[i].y;
  }
  return acc / max(ws, 1e-6);
}

vec2 sceneUv(vec2 q) { return (q - uRegion.xy) / uRegion.zw; }

vec3 sceneAt(vec2 q) {
  vec2 uv = sceneUv(q);
  return mix(textureLod(uScene, uv, 0.0).rgb, textureLod(uBlur, uv, 0.0).rgb, uFrost);
}

float shadowAt(vec2 q) {
  float ds = sdf(q - uShadowOff);
  return uShadow * (1.0 - smoothstep(-uShadowBlur * 0.5, uShadowBlur, ds));
}

vec2 floorLight(vec2 q) {
  float sh = shadowAt(q);
  if (uCaustic < 0.001) return vec2(sh, 0.0);
  float dc = sdf(q - uShadowOff * 0.55);
  float bev = max(uBevel, 2.0 * uDpr);
  float ring = exp(-pow((dc + bev * 0.45) / (bev * 0.28 + uDpr), 2.0));
  float core = smoothstep(0.0, -bev * 1.5, dc) * 0.35;
  return vec2(sh, uCaustic * (ring + core));
}

vec3 lit(vec3 c, vec2 fl) { return c * (1.0 - fl.x) + fl.y * (c * 0.9 + vec3(0.1)); }

vec3 spectral(float w) {
  return clamp(vec3(1.0 - 2.2 * abs(w - 0.08), 1.0 - 2.2 * abs(w - 0.5), 1.0 - 2.2 * abs(w - 0.92)), 0.0, 1.0);
}

float shoulder(float v) {
  return pow(max(1.0 - pow(1.0 - v, uCurve), 0.0), 1.0 / uCurve);
}

float profile(float t) {
  float v = clamp(t / max(uBevel, 1.0), 0.0, 1.0);
  float f;
  if (uCut >= 0.0) {
    float s0 = shoulder(uCut);
    f = (shoulder(uCut + (1.0 - uCut) * v) - s0) / max(1.0 - s0, 1e-3);
  } else {
    f = -uCut + (1.0 + uCut) * shoulder(v);
  }
  float L = 46.0 * uDpr;
  return uThick * f + uLens * uThick * (1.0 - exp(-t / L));
}

float depthDome(float t, float r) {
  float u = 1.0 - clamp(t / max(r, 1.0), 0.0, 1.0);
  return sqrt(max(1.0 - u * u, 0.0));
}

float ovalOf(int i, vec2 p, float t) {
  vec4 R = uRects[i];
  float oval = depthDome(t, min(R.z, R.w));
  if (abs(R.z - R.w) >= 1.0) {
    vec2 l = p - R.xy;
    float x = R.z > R.w ? l.x / R.z : l.y / R.w;
    oval *= sqrt(max(1.0 - x * x, 0.0));
  }
  return oval;
}

float heightAt(vec2 q) {
  float d = sdf(q);
  if (d > 0.0) return 0.0;
  float t = -d;
  float k = max(uMerge * 0.25, uDpr);
  float ws = 0.0;
  float acc = 0.0;
  for (int i = 0; i < ${MAX_SHAPES}; i++) {
    if (i >= uN) break;
    float w = exp(-max(shapeDist(i, q), -k * 8.0) / k);
    ws += w;
    acc += w * ovalOf(i, q, t);
  }
  float oval = acc / max(ws, 1e-6);
  return profile(t) * mix(1.0, oval, uBody);
}

// Height of the glass at p and its gradient (from 18 samples around p). This is most of the
// shader's cost and depends only on the shapes and the glass settings, so the renderer bakes it
// into a texture (SURFACE) and the glass pass reads it back while only the backdrop changes.
vec3 surfaceLive(vec2 p, float t) {
  float h = heightAt(p);
  float sigma = max(0.75 * uDpr, 0.45 * t);
  vec2 gh = vec2(0.0);
  float norm = 0.0;
  for (int k = 0; k < 3; k++) {
    float r = sigma * (0.55 + 0.75 * float(k));
    float w = r * exp(-0.5 * r * r / (sigma * sigma));
    vec2 acc = vec2(0.0);
    for (int i = 0; i < 6; i++) {
      float a = (float(i) + 0.5 * float(k)) * 1.047198;
      vec2 dir = vec2(cos(a), sin(a));
      acc += heightAt(p + dir * r) * dir;
    }
    gh += w * acc;
    norm += w * 3.0 * r;
  }
  return vec3(gh / norm, h);
}

#ifdef BAKED
uniform sampler2D uSurface;
vec3 surfaceAt(vec2 p, float t) { return texelFetch(uSurface, ivec2(gl_FragCoord.xy), 0).xyz; }
#else
vec3 surfaceAt(vec2 p, float t) { return surfaceLive(p, t); }
#endif

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  if (uN == 0 || any(lessThan(p, uBounds.xy)) || any(greaterThan(p, uBounds.zw))) {
    o = vec4(0.0);
    return;
  }
  float alpha = alphaAt(p);
  float d = sdf(p);
  float shadow = shadowAt(p) * alpha;
  if (d > 2.0) {
    o = vec4(0.0, 0.0, 0.0, shadow);
    return;
  }

  float t = max(-d, 0.0);
  vec3 surf = surfaceAt(p, t);
  float h = surf.z;
  vec2 gh = surf.xy;
  float slope = length(gh);
  vec3 n = normalize(vec3(-gh, 1.0));
  float ge = 1.5 * uDpr;
  vec2 gn = vec2(sdf(p + vec2(ge, 0)) - sdf(p - vec2(ge, 0)), sdf(p + vec2(0, ge)) - sdf(p - vec2(0, ge)));
  gn /= max(length(gn), 1e-5);
  vec3 I = vec3(0.0, 0.0, -1.0);

  int N = uDisp > 0.001 ? 7 : 1;
  vec3 acc = vec3(0.0);
  vec3 wsum = vec3(0.0);
  vec2 q0 = p;
  for (int i = 0; i < 7; i++) {
    if (i >= N) break;
    float w = N == 1 ? 0.5 : float(i) / float(N - 1);
    float ior = uIor + uDisp * (w - 0.5) * 2.0;
    vec3 T = refract(I, n, 1.0 / ior);
    vec2 q = p + T.xy / max(-T.z, 0.25) * h * uFlip;
    if (i == N / 2) q0 = q;
    vec3 wt = N == 1 ? vec3(1.0) : spectral(w);
    acc += sceneAt(q) * wt;
    wsum += wt;
  }
  vec3 col = acc / wsum;
  vec2 fl = floorLight(q0);
  col = lit(col, vec2(fl.x * 0.3, fl.y));

  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(luma), col, uSat), 0.0);
  col = mix(col, uTint.rgb, uTint.a);

  vec2 L2 = normalize(uLight.xy + 1e-5);
  float edge = length(n.xy);
  col *= 1.0 - 0.45 * smoothstep(0.8, 0.99, edge) * min(uThick / (30.0 * uDpr), 1.0);

  float F0 = pow((uIor - 1.0) / (uIor + 1.0), 2.0);
  float F = F0 + (1.0 - F0) * pow(1.0 - n.z, 5.0);
  vec3 R = reflect(I, n);
  float studio = 0.12 + 0.95 * pow(max(dot(normalize(R), uLight), 0.0), 3.0);
  vec3 around = textureLod(uBlur, sceneUv(p - R.xy * 50.0 * uDpr), 2.0).rgb;
  vec3 env = mix(vec3(0.015), mix(around * 1.15, vec3(studio), 0.55), uStudio);
  col = mix(col, env, clamp(F * uRefl * 1.6, 0.0, 1.0));

  float film = uIrid * (F * 2.5 + 0.35 * smoothstep(uBevel, 0.0, t));
  vec3 thin = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + h / max(uThick, 1.0) * 1.6 + dot(gn, L2) * 0.45 + slope * 0.12));
  col += thin * film * 0.55;

  vec3 V = vec3(0.0, 0.0, 1.0);
  float nh = max(dot(n, normalize(uLight + V)), 0.0);
  float sp = pow(nh, uShin) + 0.12 * pow(nh, uShin * 0.12) * smoothstep(0.05, 0.4, length(n.xy));
  vec3 Lb = normalize(vec3(-uLight.xy, uLight.z));
  sp += 0.4 * pow(max(dot(n, normalize(Lb + V)), 0.0), uShin);
  col += sp * uSpec;

  float rimW = exp(-t / (0.9 * uDpr));
  float dir = mix(1.0, 0.2 + 0.8 * pow(abs(dot(gn, L2)), 1.5), uRimDir);
  col += rimW * dir * uRim * vec3(1.0);

  float de = 0.75;
  float ex = sdf(p + vec2(de, 0)) - sdf(p - vec2(de, 0));
  float ey = sdf(p + vec2(0, de)) - sdf(p - vec2(0, de));
  float dist = d / max(length(vec2(ex, ey)) / (2.0 * de), 0.2);
  float cover = smoothstep(0.75, -0.75, dist) * alpha;
  o = vec4(clamp(col, 0.0, 1.0) * cover, cover + shadow * (1.0 - cover));
}`;

// The glass pass reading the baked surface instead of computing it.
export const GLASS_BAKED = GLASS.replace('#version 300 es\n', '#version 300 es\n#define BAKED\n');

// Bakes surfaceLive() into an RGBA16F target the size of the canvas: xy = gradient, z = height.
// Same pixel grid as the glass pass, which reads it back with texelFetch, so the result is the same.
export const SURFACE = `${GLASS.slice(0, GLASS.indexOf('void main() {'))}void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  float d = sdf(p);
  if (uN == 0 || d > 2.0) {
    o = vec4(0.0);
    return;
  }
  o = vec4(surfaceLive(p, max(-d, 0.0)), 1.0);
}`;
