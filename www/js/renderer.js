// Custom WebGL2 renderer. Static level geometry with baked lighting + AO (with grid line-of-sight shadows),
// per-pixel flashlights, flickering dynamic lights, billboard entities and a found-footage post pass.
import { makeTexture, makeExitTexture, makeSignTexture, makePanelTexture, makeGlowTexture } from './textures.js';
import { buildAtlases, CELL_W, CELL_H, ATLAS, COLS } from './sprites.js';
import { lineOfSight, WALL } from './mapgen.js';

const MAX_DYN = 8, MAX_FLASH = 4;

const COMMON = /* glsl */`
float hash11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float flickerF(float t, float s){
  float burst = hash11(floor(t * 0.7 + s * 3.1) + s * 17.0);
  float fast = hash11(floor(t * 14.0) + s * 91.0);
  return burst > 0.55 ? (fast > 0.45 ? 1.0 : 0.06) : (0.92 + 0.08 * fast);
}
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0); }
`;

const LIGHTING = /* glsl */`
uniform vec3 uCam;
uniform vec3 uAmbient;
uniform float uPower;
uniform float uTime;
uniform int uNumDyn;
uniform vec3 uDynPos[${MAX_DYN}];
uniform vec4 uDynCol[${MAX_DYN}]; // rgb, range
uniform int uNumFlash;
uniform vec3 uFlPos[${MAX_FLASH}];
uniform vec4 uFlDir[${MAX_FLASH}]; // xyz dir, w intensity
uniform vec3 uFog;
uniform float uFogD;
uniform float uExposure;

vec3 flashlights(vec3 P, vec3 N, vec3 V, float spec, out vec3 specOut){
  vec3 acc = vec3(0.0); specOut = vec3(0.0);
  for(int i=0;i<${MAX_FLASH};i++){
    if(i>=uNumFlash) break;
    vec3 L = uFlPos[i]-P; float d = length(L); vec3 l = L/max(d,1e-4);
    float c = dot(-l, normalize(uFlDir[i].xyz));
    float cone = smoothstep(0.80, 0.93, c);
    float hot = smoothstep(0.955, 0.995, c);
    float ring = 0.95 + 0.05 * sin(acos(clamp(c,-1.0,1.0)) * 60.0);
    float att = 1.0 / (1.0 + 0.045 * d * d);
    float ndl = max(dot(N, l), 0.0);
    vec3 col = vec3(1.0, 0.95, 0.86) * uFlDir[i].w * (cone * ring * 1.6 + hot * 1.2) * att;
    acc += col * ndl;
    vec3 H = normalize(l + V);
    specOut += col * pow(max(dot(N,H),0.0), 48.0) * spec;
  }
  return acc;
}
vec3 dynLights(vec3 P, vec3 N){
  vec3 acc = vec3(0.0);
  for(int i=0;i<${MAX_DYN};i++){
    if(i>=uNumDyn) break;
    vec3 L = uDynPos[i]-P; float d = length(L);
    float r = uDynCol[i].w;
    float w = clamp(1.0 - d / r, 0.0, 1.0);
    float att = w * w / (1.0 + 0.25 * d * d);
    acc += uDynCol[i].rgb * att * max(dot(N, L / max(d,1e-4)), 0.0) * 3.0;
  }
  return acc;
}
vec3 finish(vec3 col, vec3 P){
  float dist = length(P - uCam);
  float f = 1.0 - exp(-uFogD * dist * 1.0);
  col = mix(col, uFog, clamp(f,0.0,1.0));
  col = aces(col * uExposure);
  return pow(col, vec3(1.0/2.2));
}
`;

const WORLD_VS = /* glsl */`#version 300 es
precision highp float;
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNorm; layout(location=2) in vec2 aUV;
layout(location=3) in vec4 aLight; layout(location=4) in float aFlick;
uniform mat4 uVP;
out vec3 vPos; out vec3 vNorm; out vec2 vUV; out vec4 vLight; out float vFlick;
void main(){ vPos=aPos; vNorm=aNorm; vUV=aUV; vLight=aLight; vFlick=aFlick; gl_Position=uVP*vec4(aPos,1.0); }`;

const WORLD_FS = /* glsl */`#version 300 es
precision highp float;
${COMMON}
${LIGHTING}
in vec3 vPos; in vec3 vNorm; in vec2 vUV; in vec4 vLight; in float vFlick;
uniform sampler2D uTex;
uniform int uMode; // 0 lit, 1 emissive, 2 water
uniform float uSpec;
uniform float uWaterY;
out vec4 o;
void main(){
  vec3 N = normalize(vNorm);
  vec3 V = normalize(uCam - vPos);
  if(uMode==1){
    vec3 e = texture(uTex, vUV).rgb;
    e = pow(e, vec3(2.2));
    float k = vFlick < -0.5 ? 0.025 : (vFlick > 0.5 ? flickerF(uTime, vFlick) : 1.0);
    vec3 col = e * vLight.rgb * k * uPower * 3.0;
    o = vec4(finish(col, vPos), 1.0);
    return;
  }
  if(uMode==2){
    // animated water surface
    vec2 p = vPos.xz;
    float t = uTime;
    vec3 wn = normalize(vec3(
      sin(p.x*2.1+t*1.3)*0.06 + sin(p.y*3.7-t*0.9)*0.04 + sin((p.x+p.y)*5.3+t*2.1)*0.02,
      1.0,
      cos(p.y*2.4+t*1.1)*0.06 + cos(p.x*3.1+t*1.7)*0.04));
    vec3 sp; vec3 fl = flashlights(vPos, wn, V, 6.0, sp);
    vec3 base = vec3(0.04,0.09,0.11) * (vLight.rgb * uPower + uAmbient * 2.0 + fl * 0.4 + dynLights(vPos, wn));
    float fres = pow(1.0 - max(dot(wn, V), 0.0), 4.0);
    vec3 col = base + sp * 1.4 + uFog * fres * 0.6 + vLight.rgb * uPower * fres * 0.5;
    o = vec4(finish(col, vPos), 0.72 + fres * 0.25);
    return;
  }
  vec3 albedo = pow(texture(uTex, vUV).rgb, vec3(2.2));
  float ao = vLight.a;
  vec3 sp; vec3 fl = flashlights(vPos, N, V, uSpec, sp);
  vec3 light = vLight.rgb * uPower + uAmbient * ao + dynLights(vPos, N) * ao + fl;
  // submerged surfaces darken with depth
  if(uWaterY > 0.0 && vPos.y < uWaterY){ light *= mix(0.35, 0.8, vPos.y / uWaterY); albedo *= vec3(0.6,0.85,0.9); }
  vec3 col = albedo * light + sp * ao;
  o = vec4(finish(col, vPos), 1.0);
}`;

const SPRITE_VS = /* glsl */`#version 300 es
precision highp float;
layout(location=0) in vec3 aPos; layout(location=1) in vec2 aUV; layout(location=2) in vec3 aLight; layout(location=3) in vec4 aParam;
uniform mat4 uVP;
out vec3 vPos; out vec2 vUV; out vec3 vLight; out vec4 vParam;
void main(){ vPos=aPos; vUV=aUV; vLight=aLight; vParam=aParam; gl_Position=uVP*vec4(aPos,1.0); }`;

const SPRITE_FS = /* glsl */`#version 300 es
precision highp float;
${COMMON}
${LIGHTING}
in vec3 vPos; in vec2 vUV; in vec3 vLight; in vec4 vParam; // emissive, alpha, glitch, tint
uniform sampler2D uAlb; uniform sampler2D uEmi;
out vec4 o;
void main(){
  vec2 uv = vUV;
  if(vParam.z > 0.0){
    float band = floor(uv.y * 160.0 + uTime * 30.0);
    uv.x += (hash11(band + floor(uTime*20.0)) - 0.5) * 0.02 * vParam.z;
  }
  vec4 a = texture(uAlb, uv);
  float alpha = a.a * vParam.y;
  if(alpha < 0.45) discard;
  vec3 V = normalize(uCam - vPos);
  vec3 N = normalize(vec3(V.x, 0.0, V.z));
  vec3 sp; vec3 fl = flashlights(vPos, N, V, 0.0, sp);
  vec3 albedo = pow(a.rgb, vec3(2.2)) * vParam.w;
  vec3 col = albedo * (vLight * uPower + uAmbient + dynLights(vPos, N) + fl);
  col += pow(texture(uEmi, uv).rgb, vec3(2.2)) * vParam.x * 2.5;
  o = vec4(finish(col, vPos), 1.0);
}`;

const GLOW_VS = /* glsl */`#version 300 es
precision highp float;
layout(location=0) in vec3 aPos; layout(location=1) in vec2 aUV; layout(location=2) in vec4 aCol;
uniform mat4 uVP; out vec2 vUV; out vec4 vCol;
void main(){ vUV=aUV; vCol=aCol; gl_Position=uVP*vec4(aPos,1.0); }`;
const GLOW_FS = /* glsl */`#version 300 es
precision highp float;
in vec2 vUV; in vec4 vCol; uniform sampler2D uTex; out vec4 o;
void main(){ float g = texture(uTex, vUV).a; g *= g; o = vec4(vCol.rgb * g * vCol.a, 1.0); }`;

const POST_VS = /* glsl */`#version 300 es
layout(location=0) in vec2 aPos; out vec2 vUV;
void main(){ vUV = aPos*0.5+0.5; gl_Position = vec4(aPos,0.0,1.0); }`;
const POST_FS = /* glsl */`#version 300 es
precision highp float;
${COMMON}
in vec2 vUV; uniform sampler2D uScene; uniform float uTime; uniform vec2 uRes;
uniform float uFear; uniform float uDamage; uniform float uSanity; uniform float uBlink; uniform float uGlitch;
out vec4 o;
float h2(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
void main(){
  vec2 uv = vUV;
  vec2 c = uv - 0.5;
  // lens barrel + low-sanity wobble
  uv = 0.5 + c * (1.0 - 0.06 * dot(c,c));
  float insane = 1.0 - uSanity;
  uv += vec2(sin(uv.y*18.0 + uTime*2.3), cos(uv.x*14.0 + uTime*1.7)) * 0.004 * insane * insane;
  // VHS tearing on glitch
  float line = floor(uv.y * 90.0);
  uv.x += (h2(vec2(line, floor(uTime*25.0))) - 0.5) * 0.03 * uGlitch;
  float ca = 0.0015 + 0.006 * uFear + 0.01 * uGlitch + 0.004 * insane;
  vec2 d = (uv - 0.5) * ca;
  vec3 col;
  col.r = texture(uScene, uv + d).r;
  col.g = texture(uScene, uv).g;
  col.b = texture(uScene, uv - d).b;
  // grain + scanlines
  float g = h2(uv * uRes + fract(uTime * 7.13) * 100.0) - 0.5;
  col += g * (0.06 + 0.06 * uFear + 0.05 * insane);
  col *= 0.97 + 0.03 * sin(uv.y * uRes.y * 1.5);
  // vignette, darker when afraid
  float vig = smoothstep(0.85, 0.25 - uFear * 0.1, length(c * vec2(1.0, 0.85)));
  col *= mix(0.35, 1.0, vig);
  // fear desaturates and reddens
  float lum = dot(col, vec3(0.299,0.587,0.114));
  col = mix(col, vec3(lum) * vec3(1.15,0.85,0.8), uFear * 0.45);
  col = mix(col, vec3(lum*1.2, 0.0, 0.0), uDamage * 0.6);
  col *= 1.0 - uBlink;
  o = vec4(col, 1.0);
}`;

function compile(gl, vs, fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s) + '\n' + src.split('\n').slice(0, 5).join('\n'));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link: ' + gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

// ---- minimal matrix math ----
export function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
export function lookDir(eye, fwd) {
  const f = fwd, len = Math.hypot(f[0], f[1], f[2]);
  const fx = f[0] / len, fy = f[1] / len, fz = f[2] / len;
  let sx = fy * 0 - fz * 1, sy = fz * 0 - fx * 0, sz = fx * 1 - fy * 0; // f x up
  const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
  const ux = sy * fz - sz * fy, uy = sz * fx - sx * fz, uz = sx * fy - sy * fx;
  return new Float32Array([
    sx, ux, -fx, 0, sy, uy, -fy, 0, sz, uz, -fz, 0,
    -(sx * eye[0] + sy * eye[1] + sz * eye[2]), -(ux * eye[0] + uy * eye[1] + uz * eye[2]), fx * eye[0] + fy * eye[1] + fz * eye[2], 1,
  ]);
}
export function mul4(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
export function forwardVec(yaw, pitch) {
  return [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
}

export function flickerJS(t, s) {
  const hash11 = (p) => { p = (p * 0.1031) % 1; if (p < 0) p += 1; p *= p + 33.33; p *= p + p; return p - Math.floor(p); };
  const burst = hash11(Math.floor(t * 0.7 + s * 3.1) + s * 17.0);
  const fast = hash11(Math.floor(t * 14.0) + s * 91.0);
  return burst > 0.55 ? (fast > 0.45 ? 1.0 : 0.06) : 0.92 + 0.08 * fast;
}

class MeshBuilder {
  constructor() { this.v = []; this.i = []; this.n = 0; }
  quad(p0, p1, p2, p3, nrm, uv, lights, flick = 0) {
    // p0..p3 in CCW order seen from the front; uv: 4 pairs; lights: 4 vec4
    const base = this.n;
    const P = [p0, p1, p2, p3];
    for (let k = 0; k < 4; k++) {
      const L = lights[k];
      this.v.push(P[k][0], P[k][1], P[k][2], nrm[0], nrm[1], nrm[2], uv[k][0], uv[k][1], L[0], L[1], L[2], L[3], flick);
    }
    this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.n += 4;
  }
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not supported on this device.');
    this.gl = gl;
    this.scale = 1;
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    this.world = compile(gl, WORLD_VS, WORLD_FS);
    this.sprite = compile(gl, SPRITE_VS, SPRITE_FS);
    this.glow = compile(gl, GLOW_VS, GLOW_FS);
    this.post = compile(gl, POST_VS, POST_FS);
    this.batches = [];
    // post quad
    this.postVao = gl.createVertexArray();
    gl.bindVertexArray(this.postVao);
    const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // sprite dynamic buffers
    this.spriteVao = gl.createVertexArray(); gl.bindVertexArray(this.spriteVao);
    this.spriteVbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteVbo);
    const ss = 12 * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, ss, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, ss, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, ss, 20);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, ss, 32);
    this.spriteIbo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.spriteIbo);
    const idx = new Uint16Array(256 * 6);
    for (let q = 0; q < 256; q++) idx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    this.spriteData = new Float32Array(256 * 4 * 12);
    // glow buffers
    this.glowVao = gl.createVertexArray(); gl.bindVertexArray(this.glowVao);
    this.glowVbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.glowVbo);
    const gs = 9 * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, gs, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, gs, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, gs, 20);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.spriteIbo);
    this.glowData = new Float32Array(256 * 4 * 9);
    gl.bindVertexArray(null);

    const atl = buildAtlases();
    this.atlasAlb = this.texture(atl.albedo, { repeat: false, mip: true });
    this.atlasEmi = this.texture(atl.emissive, { repeat: false, mip: true });
    this.glowTex = this.texture(makeGlowTexture(), { repeat: false, mip: true });
    this.fbo = null;
    this.resize();
  }

  texture(src, { repeat = true, mip = true } = {}) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (mip) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4);
    } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    return t;
  }

  setScale(s) { this.scale = s; this.resize(); }

  resize() {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr)), h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    this.canvas.width = w; this.canvas.height = h;
    const rw = Math.max(1, Math.floor(w * this.scale)), rh = Math.max(1, Math.floor(h * this.scale));
    if (this.fbo && this.rw === rw && this.rh === rh) return;
    this.rw = rw; this.rh = rh;
    if (this.fbo) { gl.deleteFramebuffer(this.fbo); gl.deleteTexture(this.fboTex); gl.deleteRenderbuffer(this.fboDepth); }
    this.fboTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, rw, rh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.fboDepth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.fboDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, rw, rh);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.fboDepth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ---------------- level construction ----------------
  buildLevel(map, level, seed) {
    const gl = this.gl;
    for (const b of this.batches) { gl.deleteVertexArray(b.vao); gl.deleteBuffer(b.vbo); gl.deleteBuffer(b.ibo); if (b.ownTex) gl.deleteTexture(b.tex); }
    this.batches = [];
    this.map = map; this.level = level;
    const { W, H, grid, cell: cs, wallH } = map;
    const lt = level.light;
    const voidCeil = level.ceil.tex === 'void';
    const lampY = voidCeil ? Math.min(wallH * 0.8, 4.2) : wallH - 0.06;

    // static (baked) lights and flicker (dynamic) lights
    const staticLights = [], flickLights = [];
    for (const l of map.lights) {
      const pos = [(l.x + 0.5) * cs, lampY - 0.15, (l.y + 0.5) * cs];
      const col = lt.color.map((c) => c * lt.intensity);
      if (l.state === 1) staticLights.push({ pos, col, range: lt.range, cx: l.x, cy: l.y });
      if (l.state === 2) flickLights.push({ pos, col, range: lt.range, seed: l.seed, cx: l.x, cy: l.y });
    }
    // exit sign glow
    const ex = map.exit;
    const exitCol = level.exitText ? (level.danger >= 4 ? [0.8, 0.05, 0.03] : [0.1, 0.9, 0.3]) : [0.3, 0.25, 0.2];
    const dirv = [[1, 0], [-1, 0], [0, 1], [0, -1]][ex.dir];
    const exitWall = [(ex.x + 0.5 + dirv[0] * 0.5) * cs, (ex.y + 0.5 + dirv[1] * 0.5) * cs];
    staticLights.push({ pos: [exitWall[0] - dirv[0] * 0.4, Math.min(2.4, wallH - 0.3), exitWall[1] - dirv[1] * 0.4], col: exitCol.map((c) => c * 0.8), range: 6, cx: ex.x, cy: ex.y });
    this.flickLights = flickLights;
    this.exitColor = exitCol;

    // bucket lights by cell for fast lookups
    const bucket = new Map();
    for (const l of staticLights) {
      const k = l.cy * W + l.cx;
      if (!bucket.has(k)) bucket.set(k, []);
      bucket.get(k).push(l);
    }
    const reach = Math.ceil(lt.range / cs) + 1;
    const isW = (x, y) => x < 0 || y < 0 || x >= W || y >= H || grid[y * W + x] === WALL;
    const bake = (px, py, pz, nx, ny, nz) => {
      const cx = Math.floor(px / cs), cy = Math.floor(pz / cs);
      let r = 0, g = 0, b = 0;
      const sx = px + nx * 0.08, sz = pz + nz * 0.08;
      const R = Math.max(reach, 3);
      for (let yy = cy - R; yy <= cy + R; yy++) for (let xx = cx - R; xx <= cx + R; xx++) {
        const arr = bucket.get(yy * W + xx);
        if (!arr) continue;
        for (const l of arr) {
          const dx = l.pos[0] - px, dy = l.pos[1] - py, dz = l.pos[2] - pz;
          const d = Math.hypot(dx, dy, dz);
          if (d > l.range) continue;
          const ndl = (dx * nx + dy * ny + dz * nz) / (d || 1);
          if (ndl <= 0) continue;
          if (!lineOfSight(map, sx, sz, l.pos[0], l.pos[2])) continue;
          const w = 1 - d / l.range;
          const att = (w * w) / (1 + 0.25 * d * d) * 3.0;
          r += l.col[0] * att * ndl; g += l.col[1] * att * ndl; b += l.col[2] * att * ndl;
        }
      }
      return [r, g, b];
    };
    const wallDist = (px, pz) => {
      const cx = Math.floor(px / cs), cy = Math.floor(pz / cs);
      let best = 9;
      for (let yy = cy - 1; yy <= cy + 1; yy++) for (let xx = cx - 1; xx <= cx + 1; xx++) {
        if (!isW(xx, yy)) continue;
        const qx = Math.max(xx * cs, Math.min(px, (xx + 1) * cs)), qz = Math.max(yy * cs, Math.min(pz, (yy + 1) * cs));
        best = Math.min(best, Math.hypot(px - qx, pz - qz));
      }
      return best;
    };

    // per-cell light (for sprites)
    this.cellLight = new Float32Array(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (isW(x, y)) continue;
      const px = (x + 0.5) * cs, pz = (y + 0.5) * cs;
      const a = bake(px, 1.2, pz, 0, 0.7, 0), b2 = bake(px, 1.2, pz, 0.7, 0, 0), c2 = bake(px, 1.2, pz, -0.7, 0, 0);
      for (let k = 0; k < 3; k++) this.cellLight[(y * W + x) * 3 + k] = (a[k] + b2[k] + c2[k]) / 2.2;
    }

    const floorB = new MeshBuilder(), ceilB = new MeshBuilder(), wallB = new MeshBuilder();
    const T = 2.0; // texture tile size (m)
    const SUBF = 3;
    // floors & ceilings
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (isW(x, y)) continue;
      for (let sy = 0; sy < SUBF; sy++) for (let sx = 0; sx < SUBF; sx++) {
        const x0 = (x + sx / SUBF) * cs, x1 = (x + (sx + 1) / SUBF) * cs;
        const z0 = (y + sy / SUBF) * cs, z1 = (y + (sy + 1) / SUBF) * cs;
        const corners = [[x0, z0], [x0, z1], [x1, z1], [x1, z0]];
        const fl = corners.map(([px, pz]) => {
          const ao = 1 - 0.55 * Math.exp(-wallDist(px, pz) * 2.2);
          const c = bake(px, 0, pz, 0, 1, 0);
          return [c[0] * ao, c[1] * ao, c[2] * ao, ao];
        });
        floorB.quad([x0, 0, z0], [x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [0, 1, 0], corners.map(([a, b]) => [a / T, b / T]), fl);
        if (!voidCeil) {
          const cc = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
          const cl = cc.map(([px, pz]) => {
            const ao = 1 - 0.45 * Math.exp(-wallDist(px, pz) * 2.5);
            const c = bake(px, wallH, pz, 0, -1, 0);
            return [c[0] * ao, c[1] * ao, c[2] * ao, ao];
          });
          ceilB.quad([x0, wallH, z0], [x1, wallH, z0], [x1, wallH, z1], [x0, wallH, z1], [0, -1, 0], cc.map(([a, b]) => [a / T, b / T]), cl);
        }
      }
    }
    // walls (faces where floor meets wall)
    const SUBH = 2, SUBV = 4;
    const fullHeight = ['plaster', 'damask', 'kids', 'siding', 'wheat'].includes(level.wall.tex);
    const wallTileV = fullHeight ? Math.min(wallH, 3.4) : T;
    const wallTile = fullHeight ? wallTileV : T;
    const faces = [
      // [dx, dy, normal(into floor cell), edge start (cell-relative), edge dir]
      [1, 0, [-1, 0, 0], [1, 1], [0, -1]],
      [-1, 0, [1, 0, 0], [0, 0], [0, 1]],
      [0, 1, [0, 0, -1], [0, 1], [1, 0]],
      [0, -1, [0, 0, 1], [1, 0], [-1, 0]],
    ];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (isW(x, y)) continue;
      for (const [dx, dy, n, st, dir] of faces) {
        if (!isW(x + dx, y + dy)) continue;
        for (let s = 0; s < SUBH; s++) for (let v = 0; v < SUBV; v++) {
          const t0 = s / SUBH, t1 = (s + 1) / SUBH;
          const ax = (x + st[0] + dir[0] * t0) * cs, az = (y + st[1] + dir[1] * t0) * cs;
          const bx = (x + st[0] + dir[0] * t1) * cs, bz = (y + st[1] + dir[1] * t1) * cs;
          const y0 = (v / SUBV) * wallH, y1 = ((v + 1) / SUBV) * wallH;
          const P = [[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]];
          const uvs = P.map((p) => {
            const along = p[0] * Math.abs(dir[0]) + p[2] * Math.abs(dir[1]);
            return [along / wallTile, (wallH - p[1]) / wallTileV];
          });
          const L = P.map((p) => {
            let ao = 1 - 0.45 * Math.exp(-p[1] * 2.4) - 0.25 * Math.exp(-(wallH - p[1]) * 3.0);
            const side = wallDistAlong(p[0] + n[0] * 0.2, p[2] + n[2] * 0.2, dir);
            ao *= 1 - 0.35 * Math.exp(-side * 2.5);
            const c = bake(p[0], p[1], p[2], n[0], n[1], n[2]);
            return [c[0] * ao, c[1] * ao, c[2] * ao, Math.max(0.2, ao)];
          });
          // generated order winds away from n, so emit reversed
          wallB.quad(P[1], P[0], P[3], P[2], n, [uvs[1], uvs[0], uvs[3], uvs[2]], [L[1], L[0], L[3], L[2]]);
        }
      }
    }
    function wallDistAlong(px, pz, dir) {
      // distance to perpendicular walls along the face direction (for corner darkening)
      let best = 9;
      for (const sgn of [1, -1]) {
        for (let k = 0.25; k < 2.5; k += 0.25) {
          const qx = px + dir[0] * sgn * k, qz = pz + dir[1] * sgn * k;
          if (isW(Math.floor(qx / cs), Math.floor(qz / cs))) { best = Math.min(best, k); break; }
        }
      }
      return best;
    }

    const texSeed = seed & 0xffff;
    const wallTex = this.texture(makeTexture(level.wall.tex, level.wall.c1, level.wall.c2, texSeed + 1, 512));
    const floorTex = this.texture(makeTexture(level.floor.tex, level.floor.c1, level.floor.c2, texSeed + 2, 512));
    const ceilTex = this.texture(makeTexture(level.ceil.tex, level.ceil.c1, level.ceil.c2, texSeed + 3, 256));
    const spec = { water: 1.5, tile: 1.2, metal: 0.8, concrete: 0.25, carpet: 0.05, wood: 0.4, dirt: 0.05 }[level.surface] ?? 0.2;
    this.addBatch(floorB, floorTex, 0, spec);
    if (!voidCeil) this.addBatch(ceilB, ceilTex, 0, 0.1);
    this.addBatch(wallB, wallTex, 0, level.wall.tex === 'tile' ? 0.8 : 0.15);

    // light fixtures (emissive)
    const panelB = new MeshBuilder(), propB = new MeshBuilder();
    const kind = lt.panel;
    for (const l of map.lights) {
      const cx = (l.x + 0.5) * cs, cz = (l.y + 0.5) * cs;
      const col = lt.color;
      const fl = l.state === 0 ? -1 : l.state === 2 ? l.seed + 1 : 0;
      const Lc = [[col[0], col[1], col[2], 1], [col[0], col[1], col[2], 1], [col[0], col[1], col[2], 1], [col[0], col[1], col[2], 1]];
      const hw = kind === 'fluor' ? 0.6 : kind === 'emergency' ? 0.22 : 0.16;
      const hd = kind === 'fluor' ? 0.3 : kind === 'emergency' ? 0.12 : 0.16;
      const y = lampY - 0.01;
      panelB.quad([cx - hw, y, cz - hd], [cx + hw, y, cz - hd], [cx + hw, y, cz + hd], [cx - hw, y, cz + hd], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], Lc, fl);
      if (kind === 'street') {
        const p = 0.06, px = cx + 0.6, pz = cz; // pole
        const dark = [[0.02, 0.02, 0.02, 1], [0.02, 0.02, 0.02, 1], [0.02, 0.02, 0.02, 1], [0.02, 0.02, 0.02, 1]];
        for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ax = px + nx * p - nz * p, az = pz + nz * p + nx * p, bx = px + nx * p + nz * p, bz = pz + nz * p - nx * p;
          propB.quad([ax, 0, az], [bx, 0, bz], [bx, y, bz], [ax, y, az], [nx, 0, nz], [[0, 0], [0.1, 0], [0.1, 2], [0, 2]], dark);
        }
      }
    }
    this.addBatch(panelB, this.texture(makePanelTexture(kind === 'fluor' ? 'fluor' : 'bulb')), 1, 0, true);
    if (propB.n) this.addBatch(propB, wallTex, 0, 0.2);

    // exit door + sign
    const exitB = new MeshBuilder(), signB = new MeshBuilder();
    const n = [-dirv[0], 0, -dirv[1]];
    const perp = [dirv[1], 0, -dirv[0]];
    const doorW = level.exit === 'ladder' ? 0.9 : 1.3;
    const doorH = level.exit === 'ladder' ? wallH : Math.min(2.3, wallH - 0.2);
    const wx = exitWall[0] + n[0] * 0.015, wz = exitWall[1] + n[2] * 0.015;
    const dl = bake(wx + n[0] * 0.3, 1.2, wz + n[2] * 0.3, n[0], 0, n[2]);
    const light4 = [0, 1, 2, 3].map(() => [dl[0] + 0.05, dl[1] + 0.05, dl[2] + 0.05, 1]);
    const a0 = [wx - perp[0] * doorW / 2, 0, wz - perp[2] * doorW / 2], b0 = [wx + perp[0] * doorW / 2, 0, wz + perp[2] * doorW / 2];
    exitB.quad(b0, a0, [a0[0], doorH, a0[2]], [b0[0], doorH, b0[2]], n, [[0, 1], [1, 1], [1, 0], [0, 0]], light4);
    this.addBatch(exitB, this.texture(makeExitTexture(level.exit), { repeat: false }), 0, 0.3, true);
    if (level.exitText) {
      const sy = Math.min(doorH + 0.35, wallH - 0.15), sw = 0.45;
      const sx = wx + n[0] * 0.01, sz = wz + n[2] * 0.01;
      const sa = [sx - perp[0] * sw, sy - 0.11, sz - perp[2] * sw], sb = [sx + perp[0] * sw, sy - 0.11, sz + perp[2] * sw];
      const ec = exitCol.concat([1]);
      const css = `rgb(${exitCol.map((c) => Math.min(255, c * 300) | 0).join(',')})`;
      signB.quad(sb, sa, [sa[0], sy + 0.11, sa[2]], [sb[0], sy + 0.11, sb[2]], n, [[0, 1], [1, 1], [1, 0], [0, 0]], [ec, ec, ec, ec], 0);
      this.addBatch(signB, this.texture(makeSignTexture(level.exitText, css), { repeat: false }), 1, 0, true);
    }
    this.exitPos = [wx + n[0] * 0.8, wz + n[2] * 0.8];

    // water surface
    this.waterBatch = null;
    if (level.water > 0) {
      const wb = new MeshBuilder();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (isW(x, y)) continue;
        const x0 = x * cs, x1 = (x + 1) * cs, z0 = y * cs, z1 = (y + 1) * cs, wy = level.water;
        const L = [[x0, z0], [x0, z1], [x1, z1], [x1, z0]].map(([px, pz]) => { const c = bake(px, wy, pz, 0, 1, 0); return [c[0], c[1], c[2], 1]; });
        wb.quad([x0, wy, z0], [x0, wy, z1], [x1, wy, z1], [x1, wy, z0], [0, 1, 0], [[0, 0], [0, 1], [1, 1], [1, 0]], L);
      }
      this.waterBatch = this.makeBatch(wb, floorTex, 2, 0, false);
    }

    // glow positions for lit fixtures
    this.glowLights = map.lights.filter((l) => l.state > 0).map((l) => ({
      pos: [(l.x + 0.5) * cs, lampY - 0.08, (l.y + 0.5) * cs], col: lt.color, seed: l.state === 2 ? l.seed + 1 : 0, size: kind === 'fluor' ? 1.1 : 0.6,
    }));
    this.glowLights.push({ pos: [exitWall[0] + n[0] * 0.05, Math.min(doorH + 0.35, wallH - 0.15), exitWall[1] + n[2] * 0.05], col: exitCol.map((c) => c * 1.5), seed: 0, size: 0.9 });
  }

  makeBatch(mb, tex, mode, spec, ownTex) {
    const gl = this.gl;
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mb.v), gl.STATIC_DRAW);
    const st = 13 * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, st, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, st, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, st, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, st, 32);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, st, 48);
    const ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(mb.i), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, vbo, ibo, count: mb.i.length, tex, mode, spec, ownTex: true };
  }
  addBatch(mb, tex, mode, spec, ownTex) {
    if (!mb.n) return;
    this.batches.push(this.makeBatch(mb, tex, mode, spec, ownTex));
  }

  lightAt(x, z) {
    if (!this.map) return [0, 0, 0];
    const cx = Math.floor(x / this.map.cell), cy = Math.floor(z / this.map.cell);
    if (cx < 0 || cy < 0 || cx >= this.map.W || cy >= this.map.H) return [0, 0, 0];
    const i = (cy * this.map.W + cx) * 3;
    return [this.cellLight[i], this.cellLight[i + 1], this.cellLight[i + 2]];
  }

  setLightingUniforms(prog, f) {
    const gl = this.gl, u = prog.u, lv = this.level;
    gl.uniformMatrix4fv(u.uVP, false, f.vp);
    gl.uniform3fv(u.uCam, f.eye);
    gl.uniform3fv(u.uAmbient, lv.ambient.map((a) => a * (f.ambientMul ?? 1)));
    gl.uniform1f(u.uPower, f.power);
    gl.uniform1f(u.uTime, f.time);
    gl.uniform3fv(u.uFog, lv.fog);
    gl.uniform1f(u.uFogD, lv.fogD * (f.fogMul ?? 1));
    gl.uniform1f(u.uExposure, f.exposure ?? 1.3);
    gl.uniform1i(u.uNumDyn, f.dyn.length);
    if (f.dyn.length) {
      const p = new Float32Array(MAX_DYN * 3), c = new Float32Array(MAX_DYN * 4);
      f.dyn.forEach((d, i) => { p.set(d.pos, i * 3); c.set([d.col[0], d.col[1], d.col[2], d.range], i * 4); });
      gl.uniform3fv(u.uDynPos, p); gl.uniform4fv(u.uDynCol, c);
    }
    gl.uniform1i(u.uNumFlash, f.flash.length);
    if (f.flash.length) {
      const p = new Float32Array(MAX_FLASH * 3), d = new Float32Array(MAX_FLASH * 4);
      f.flash.forEach((fl, i) => { p.set(fl.pos, i * 3); d.set([fl.dir[0], fl.dir[1], fl.dir[2], fl.intensity], i * 4); });
      gl.uniform3fv(u.uFlPos, p); gl.uniform4fv(u.uFlDir, d);
    }
  }

  // frame: { eye, yaw, pitch, fov, roll, time, power, flash:[], sprites:[], post:{} }
  render(f) {
    const gl = this.gl;
    if (!this.level) return;
    this.resize();
    const aspect = this.rw / this.rh;
    const fwd = forwardVec(f.yaw, f.pitch);
    const proj = perspective(f.fov, aspect, 0.05, 140);
    let view = lookDir(f.eye, fwd);
    if (f.roll) {
      const c = Math.cos(f.roll), s = Math.sin(f.roll);
      view = mul4(new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), view);
    }
    f.vp = mul4(proj, view);

    // pick nearest flickering lights as dynamic lights
    const dyn = [];
    if (this.flickLights.length && f.power > 0.01) {
      const ranked = this.flickLights
        .map((l) => ({ l, d: (l.pos[0] - f.eye[0]) ** 2 + (l.pos[2] - f.eye[2]) ** 2 }))
        .filter((o) => o.d < 30 * 30)
        .sort((a, b) => a.d - b.d).slice(0, MAX_DYN);
      for (const { l } of ranked) {
        const k = flickerJS(f.time, l.seed + 1);
        dyn.push({ pos: l.pos, col: l.col.map((c) => c * k), range: l.range });
      }
    }
    f.dyn = dyn;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.rw, this.rh);
    const fog = this.level.fog;
    const fc = f.clearCol || [Math.pow(fog[0], 1 / 2.2) * 0.9, Math.pow(fog[1], 1 / 2.2) * 0.9, Math.pow(fog[2], 1 / 2.2) * 0.9];
    gl.clearColor(fc[0], fc[1], fc[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(gl.CCW);
    gl.disable(gl.BLEND);

    const W = this.world;
    gl.useProgram(W.p);
    this.setLightingUniforms(W, f);
    gl.uniform1i(W.u.uTex, 0);
    gl.uniform1f(W.u.uWaterY, this.level.water || 0);
    gl.activeTexture(gl.TEXTURE0);
    for (const b of this.batches) {
      gl.uniform1i(W.u.uMode, b.mode);
      gl.uniform1f(W.u.uSpec, b.spec);
      gl.bindTexture(gl.TEXTURE_2D, b.tex);
      gl.bindVertexArray(b.vao);
      gl.drawElements(gl.TRIANGLES, b.count, gl.UNSIGNED_INT, 0);
    }

    // sprites (entities, players, items) — alpha tested, depth written
    this.drawSprites(f, fwd);

    // water (blended)
    if (this.waterBatch) {
      gl.useProgram(W.p);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.uniform1i(W.u.uMode, 2);
      gl.bindVertexArray(this.waterBatch.vao);
      gl.drawElements(gl.TRIANGLES, this.waterBatch.count, gl.UNSIGNED_INT, 0);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    this.drawGlows(f, fwd);

    // post
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    const P = this.post, pp = f.post || {};
    gl.useProgram(P.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.uniform1i(P.u.uScene, 0);
    gl.uniform1f(P.u.uTime, f.time);
    gl.uniform2f(P.u.uRes, this.rw, this.rh);
    gl.uniform1f(P.u.uFear, pp.fear || 0);
    gl.uniform1f(P.u.uDamage, pp.damage || 0);
    gl.uniform1f(P.u.uSanity, pp.sanity ?? 1);
    gl.uniform1f(P.u.uBlink, pp.blink || 0);
    gl.uniform1f(P.u.uGlitch, pp.glitch || 0);
    gl.bindVertexArray(this.postVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  drawSprites(f, fwd) {
    const gl = this.gl;
    const list = f.sprites;
    if (!list || !list.length) return;
    const d = this.spriteData;
    let q = 0;
    // camera right vector (horizontal)
    const rx = -fwd[2], rz = fwd[0];
    const rl = Math.hypot(rx, rz) || 1;
    for (const s of list) {
      if (q >= 255) break;
      const w = s.w, h = s.h;
      const rX = (rx / rl) * w / 2, rZ = (rz / rl) * w / 2;
      const slot = s.slot;
      const u0 = ((slot % COLS) * CELL_W + 1) / ATLAS, u1 = ((slot % COLS + 1) * CELL_W - 1) / ATLAS;
      const v0 = (Math.floor(slot / COLS) * CELL_H + 1) / ATLAS, v1 = ((Math.floor(slot / COLS) + 1) * CELL_H - 1) / ATLAS;
      const flipX = s.flip ? 1 : 0;
      const ua = flipX ? u1 : u0, ub = flipX ? u0 : u1;
      // lean: rotate top corners sideways around the base (for peeking)
      const lean = s.lean || 0;
      const lx = (rx / rl) * Math.sin(lean) * h, lz = (rz / rl) * Math.sin(lean) * h, ly = Math.cos(lean) * h;
      let corners;
      if (s.ceiling) { // hanging upside down from y = s.y
        corners = [[s.x - rX, s.y, s.z - rZ, ua, v0], [s.x + rX, s.y, s.z + rZ, ub, v0], [s.x + rX, s.y - h, s.z + rZ, ub, v1], [s.x - rX, s.y - h, s.z - rZ, ua, v1]];
      } else {
        corners = [[s.x - rX, s.y, s.z - rZ, ua, v1], [s.x + rX, s.y, s.z + rZ, ub, v1], [s.x + rX + lx, s.y + ly, s.z + rZ + lz, ub, v0], [s.x - rX + lx, s.y + ly, s.z - rZ + lz, ua, v0]];
      }
      const L = this.lightAt(s.x, s.z);
      for (let k = 0; k < 4; k++) {
        const o = (q * 4 + k) * 12;
        d[o] = corners[k][0]; d[o + 1] = corners[k][1]; d[o + 2] = corners[k][2];
        d[o + 3] = corners[k][3]; d[o + 4] = corners[k][4];
        d[o + 5] = L[0]; d[o + 6] = L[1]; d[o + 7] = L[2];
        d[o + 8] = s.emissive ?? 1; d[o + 9] = s.alpha ?? 1; d[o + 10] = s.glitch || 0; d[o + 11] = s.tint ?? 1;
      }
      q++;
    }
    const S = this.sprite;
    gl.useProgram(S.p);
    this.setLightingUniforms(S, f);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.atlasAlb);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.atlasEmi);
    gl.uniform1i(S.u.uAlb, 0); gl.uniform1i(S.u.uEmi, 1);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.spriteVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteVbo);
    gl.bufferData(gl.ARRAY_BUFFER, d.subarray(0, q * 4 * 12), gl.DYNAMIC_DRAW);
    gl.drawElements(gl.TRIANGLES, q * 6, gl.UNSIGNED_SHORT, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.CULL_FACE);
  }

  drawGlows(f, fwd) {
    const gl = this.gl;
    if (!this.glowLights || f.power < 0.02) return;
    const d = this.glowData;
    const ux = 0, uy = 1;
    const rx = -fwd[2], rz = fwd[0], rl = Math.hypot(rx, rz) || 1;
    let q = 0;
    for (const g of this.glowLights) {
      const dx = g.pos[0] - f.eye[0], dz = g.pos[2] - f.eye[2];
      const dist2 = dx * dx + dz * dz;
      if (dist2 > 28 * 28) continue;
      if ((dx * fwd[0] + dz * fwd[2]) < -1) continue;
      if (!lineOfSight(this.map, f.eye[0], f.eye[2], g.pos[0], g.pos[2])) continue;
      const k = (g.seed ? flickerJS(f.time, g.seed) : 1) * f.power;
      const s = g.size;
      const ax = (rx / rl) * s, az = (rz / rl) * s, ay = s * 0.6;
      const P = [[g.pos[0] - ax, g.pos[1] - ay, g.pos[2] - az, 0, 1], [g.pos[0] + ax, g.pos[1] - ay, g.pos[2] + az, 1, 1], [g.pos[0] + ax, g.pos[1] + ay * uy + ux, g.pos[2] + az, 1, 0], [g.pos[0] - ax, g.pos[1] + ay, g.pos[2] - az, 0, 0]];
      const fade = Math.max(0, 1 - Math.sqrt(dist2) / 28) * 0.3 * k;
      for (let i = 0; i < 4; i++) {
        const o = (q * 4 + i) * 9;
        d[o] = P[i][0]; d[o + 1] = P[i][1]; d[o + 2] = P[i][2]; d[o + 3] = P[i][3]; d[o + 4] = P[i][4];
        d[o + 5] = g.col[0]; d[o + 6] = g.col[1]; d[o + 7] = g.col[2]; d[o + 8] = fade;
      }
      if (++q >= 255) break;
    }
    if (!q) return;
    const G = this.glow;
    gl.useProgram(G.p);
    gl.uniformMatrix4fv(G.u.uVP, false, f.vp);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.glowTex);
    gl.uniform1i(G.u.uTex, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false); gl.disable(gl.CULL_FACE); gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.glowVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.glowVbo);
    gl.bufferData(gl.ARRAY_BUFFER, d.subarray(0, q * 4 * 9), gl.DYNAMIC_DRAW);
    gl.drawElements(gl.TRIANGLES, q * 6, gl.UNSIGNED_SHORT, 0);
    gl.depthMask(true); gl.disable(gl.BLEND); gl.enable(gl.CULL_FACE); gl.enable(gl.DEPTH_TEST);
  }
}
