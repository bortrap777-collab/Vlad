/**
 * Отрисовка на видеокарте (WebGL 1 — есть во всех iPhone и Android):
 *  - переходы в стиле Reels/TikTok/Shorts (рывок с размытием движения, зум-удар, вращение, глитч…);
 *  - смешивание соседних кадров для плавного замедления;
 *  - наложения с хромакеем (удаление фона по цвету).
 * Один и тот же код рисует предпросмотр и кадры экспорта — результат совпадает.
 */
import type { ChromaKey, TransitionType } from './model';

export type TexSource = TexImageSource;
/** Прямоугольник картинки внутри кадра, доли 0…1 (x, y, w, h) */
export type Rect = [number, number, number, number];
export const FULL: Rect = [0, 0, 1, 1];

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const COMMON = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uA;
uniform sampler2D uB;
uniform vec4 uRectA;
uniform vec4 uRectB;
uniform vec2 uRes;

vec4 sampleRect(sampler2D t, vec4 r, vec2 uv) {
  vec2 tc = (uv - r.xy) / r.zw;
  if (tc.x < 0.0 || tc.y < 0.0 || tc.x > 1.0 || tc.y > 1.0) return vec4(0.0);
  return texture2D(t, tc);
}
// Зеркальное продолжение картинки за краем (для зума и вращения — без пустых углов)
vec4 sampleMirror(sampler2D t, vec4 r, vec2 uv) {
  vec2 tc = (uv - r.xy) / r.zw;
  tc = 1.0 - abs(1.0 - mod(tc, 2.0));
  return texture2D(t, clamp(tc, 0.001, 0.999));
}
vec4 A(vec2 uv) { return sampleRect(uA, uRectA, uv); }
vec4 B(vec2 uv) { return sampleRect(uB, uRectB, uv); }
vec4 AM(vec2 uv) { return sampleMirror(uA, uRectA, uv); }
vec4 BM(vec2 uv) { return sampleMirror(uB, uRectB, uv); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

const TRANS_FRAG = `${COMMON}
uniform float uP;
uniform float uType;
uniform float uSeed;

float easeInOut(float t) { return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0; }
float easeIn(float t) { return t * t * t; }
float easeOut(float t) { return 1.0 - pow(1.0 - t, 3.0); }

// Рывок: картинка улетает в сторону d с размытием движения, следующая прилетает следом
vec4 whipAt(vec2 uv, vec2 d, float e) {
  vec2 q = uv + d * e;
  if (q.x >= 0.0 && q.y >= 0.0 && q.x <= 1.0 && q.y <= 1.0) return AM(q);
  return BM(q - d);
}
vec4 whip(vec2 uv, vec2 d) {
  float e = easeInOut(uP);
  float s = sin(3.14159 * uP) * 0.22;
  vec4 c = vec4(0.0);
  for (int i = 0; i < 16; i++) {
    float k = float(i) / 15.0 - 0.5;
    c += whipAt(uv + d * s * k, d, e);
  }
  return c / 16.0;
}

// Радиальное размытие к центру
vec4 zoomBlur(bool useA, vec2 uv, float scale, float strength) {
  vec2 c = vec2(0.5);
  vec2 p = c + (uv - c) / scale;
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 14; i++) {
    float k = 1.0 - strength * float(i) / 13.0;
    vec2 q = c + (p - c) * k;
    acc += useA ? AM(q) : BM(q);
  }
  return acc / 14.0;
}

vec2 rot(vec2 v, float a) { float s = sin(a), c = cos(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
vec4 spinAt(bool useA, vec2 uv, float ang, float scale, float blur) {
  vec2 c = vec2(0.5);
  vec2 asp = vec2(uRes.x / uRes.y, 1.0);
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 12; i++) {
    float a = ang + blur * (float(i) / 11.0 - 0.5);
    vec2 v = rot((uv - c) * asp, a) / asp / scale;
    acc += useA ? AM(c + v) : BM(c + v);
  }
  return acc / 12.0;
}

vec4 blurAt(bool useA, vec2 uv, float r) {
  vec4 acc = useA ? AM(uv) : BM(uv);
  float n = 1.0;
  for (int i = 0; i < 16; i++) {
    float a = float(i) * 2.39996;
    float d = sqrt((float(i) + 0.5) / 16.0) * r;
    vec2 o = vec2(cos(a), sin(a)) * d * vec2(uRes.y / uRes.x, 1.0);
    acc += useA ? AM(uv + o) : BM(uv + o);
    n += 1.0;
  }
  return acc / n;
}

void main() {
  vec2 uv = vUv;
  float p = clamp(uP, 0.0, 1.0);
  float t = uType;
  vec4 col;
  if (t < 0.5) { // dissolve
    col = mix(A(uv), B(uv), easeInOut(p));
  } else if (t < 1.5) { // slideleft
    float e = easeInOut(p);
    col = uv.x < 1.0 - e ? A(uv + vec2(e, 0.0)) : B(uv - vec2(1.0 - e, 0.0));
  } else if (t < 2.5) { // slideup
    float e = easeInOut(p);
    col = uv.y < 1.0 - e ? A(uv + vec2(0.0, e)) : B(uv - vec2(0.0, 1.0 - e));
  } else if (t < 3.5) { // wipe
    float e = easeInOut(p);
    col = uv.x < e ? B(uv) : A(uv);
    float edge = smoothstep(0.03, 0.0, abs(uv.x - e)) * step(0.001, e) * step(e, 0.999);
    col = mix(col, vec4(1.0), edge * 0.35);
  } else if (t < 4.5) { // zoom (классический наезд)
    float e = easeInOut(p);
    float z = 1.0 + e * 0.6;
    vec4 a = A(vec2(0.5) + (uv - vec2(0.5)) / z);
    col = mix(B(uv), a, (1.0 - e) * a.a);
  } else if (t < 5.5) { // circle
    float e = easeInOut(p);
    vec2 d = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
    float r = e * length(vec2(uRes.x / uRes.y, 1.0)) * 0.5;
    col = mix(B(uv), A(uv), smoothstep(r - 0.004, r + 0.004, length(d)));
  } else if (t < 6.5) { col = whip(uv, vec2(1.0, 0.0)); }   // whipleft
  else if (t < 7.5) { col = whip(uv, vec2(-1.0, 0.0)); }    // whipright
  else if (t < 8.5) { col = whip(uv, vec2(0.0, 1.0)); }     // whipup
  else if (t < 9.5) { col = whip(uv, vec2(0.0, -1.0)); }    // whipdown
  else if (t < 10.5) { // zoomin — зум-удар
    if (p < 0.5) { float k = easeIn(p * 2.0); col = zoomBlur(true, uv, 1.0 + k * 2.2, k * 0.35); }
    else { float k = 1.0 - easeOut(p * 2.0 - 1.0); col = zoomBlur(false, uv, 1.0 + k * 1.4, k * 0.35); }
  } else if (t < 11.5) { // zoomout
    if (p < 0.5) { float k = easeIn(p * 2.0); col = zoomBlur(true, uv, 1.0 - k * 0.55, k * 0.25); }
    else { float k = 1.0 - easeOut(p * 2.0 - 1.0); col = zoomBlur(false, uv, 1.0 + k * 0.9, k * 0.3); }
  } else if (t < 12.5) { // spin
    if (p < 0.5) { float k = easeIn(p * 2.0); col = spinAt(true, uv, k * 2.2, 1.0 + k * 0.6, k * 0.9); }
    else { float k = 1.0 - easeOut(p * 2.0 - 1.0); col = spinAt(false, uv, -k * 2.2, 1.0 + k * 0.6, k * 0.9); }
  } else if (t < 13.5) { // glitch
    float s = sin(3.14159 * p);
    float step_ = floor(p * 14.0);
    float row = floor(uv.y * 18.0);
    float r = hash(vec2(row, step_ + uSeed));
    float shift = (r > 0.55 ? (r - 0.55) * 0.5 : 0.0) * s * (hash(vec2(step_, row)) > 0.5 ? 1.0 : -1.0);
    vec2 q = uv + vec2(shift, 0.0);
    float off = 0.025 * s;
    bool useB = p > 0.5;
    vec4 cr = useB ? BM(q + vec2(off, 0.0)) : AM(q + vec2(off, 0.0));
    vec4 cg = useB ? BM(q) : AM(q);
    vec4 cb = useB ? BM(q - vec2(off, 0.0)) : AM(q - vec2(off, 0.0));
    col = vec4(cr.r, cg.g, cb.b, 1.0);
    float band = step(0.93, hash(vec2(floor(uv.y * 60.0), step_))) * s;
    col.rgb = mix(col.rgb, vec3(hash(uv + step_)), band * 0.5);
  } else if (t < 14.5) { // flash
    float f = pow(1.0 - abs(2.0 * p - 1.0), 3.0);
    vec4 c0 = p < 0.5 ? zoomBlur(true, uv, 1.0 + easeIn(p * 2.0) * 0.25, easeIn(p * 2.0) * 0.12) : zoomBlur(false, uv, 1.0 + (1.0 - easeOut(p * 2.0 - 1.0)) * 0.25, (1.0 - easeOut(p * 2.0 - 1.0)) * 0.12);
    col = mix(c0, vec4(1.0), f);
  } else if (t < 15.5) { // blur
    float s = sin(3.14159 * p);
    vec4 a = blurAt(true, uv, s * 0.06);
    vec4 b = blurAt(false, uv, s * 0.06);
    col = mix(a, b, smoothstep(0.3, 0.7, p));
  } else if (t < 16.5) { // shake
    float s = sin(3.14159 * p);
    float st = floor(p * 20.0);
    vec2 o = (vec2(hash(vec2(st, 1.0)), hash(vec2(st, 7.0))) - 0.5) * 0.12 * s;
    vec4 acc = vec4(0.0);
    for (int i = 0; i < 8; i++) {
      vec2 q = uv + o * (float(i) / 7.0);
      acc += p < 0.5 ? AM(q) : BM(q);
    }
    col = acc / 8.0;
  } else if (t < 17.5) { // pixel
    float s = sin(3.14159 * p);
    float cells = mix(400.0, 14.0, s);
    vec2 g = vec2(cells * uRes.x / uRes.y, cells);
    vec2 q = (floor(uv * g) + 0.5) / g;
    col = mix(AM(q), BM(q), smoothstep(0.4, 0.6, p));
  } else if (t < 18.5) { // rgb
    float s = sin(3.14159 * p);
    vec2 off = vec2(0.06 * s, 0.0);
    float m = smoothstep(0.42, 0.58, p);
    vec4 cr = mix(AM(uv + off), BM(uv + off), m);
    vec4 cg = mix(AM(uv), BM(uv), m);
    vec4 cb = mix(AM(uv - off), BM(uv - off), m);
    col = vec4(cr.r, cg.g, cb.b, 1.0);
  } else { // swirl
    float s = sin(3.14159 * p);
    vec2 asp = vec2(uRes.x / uRes.y, 1.0);
    vec2 d = (uv - 0.5) * asp;
    float r = length(d);
    float a = s * 6.0 * max(0.0, 1.0 - r / 0.75);
    vec2 q = rot(d, a) / asp + 0.5;
    col = mix(AM(q), BM(q), smoothstep(0.4, 0.6, p));
  }
  gl_FragColor = vec4(col.rgb * col.a, col.a);
}`;

const BLEND_FRAG = `${COMMON}
uniform float uMix;
void main() {
  vec4 a = A(vUv);
  vec4 b = sampleRect(uB, uRectA, vUv);
  vec4 c = mix(a, b, uMix);
  gl_FragColor = vec4(c.rgb * c.a, c.a);
}`;

const OVERLAY_VERT = `
attribute vec2 aPos;
uniform vec2 uCenter;
uniform vec2 uHalf;
uniform float uRot;
uniform vec2 uRes;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  vec2 p = vec2(aPos.x, -aPos.y) * uHalf;
  float s = sin(uRot), c = cos(uRot);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + uCenter;
  vec2 clip = p / uRes * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const OVERLAY_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uA;
uniform float uOpacity;
uniform float uKeyOn;
uniform vec3 uKey;
uniform float uSim;
uniform float uSmooth;
uniform float uSpill;
vec2 cbcr(vec3 c) {
  return vec2(-0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b, 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b);
}
void main() {
  vec4 c = texture2D(uA, vUv);
  float a = c.a;
  if (uKeyOn > 0.5) {
    float d = distance(cbcr(c.rgb), cbcr(uKey));
    float lo = uSim * 0.35;
    float hi = lo + 0.002 + uSmooth * 0.25;
    float k = smoothstep(lo, hi, d);
    a *= k;
    // Убираем цветную кайму: близкие к фону пиксели обесцвечиваем
    float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
    float sp = (1.0 - smoothstep(lo, hi + 0.15, d)) * uSpill;
    c.rgb = mix(c.rgb, vec3(luma), sp);
  }
  a *= uOpacity;
  gl_FragColor = vec4(c.rgb * a, a);
}`;

const TYPE_INDEX: Partial<Record<TransitionType, number>> = {
  dissolve: 0,
  slideleft: 1,
  slideup: 2,
  wipe: 3,
  zoom: 4,
  circle: 5,
  whipleft: 6,
  whipright: 7,
  whipup: 8,
  whipdown: 9,
  zoomin: 10,
  zoomout: 11,
  spin: 12,
  glitch: 13,
  flash: 14,
  blur: 15,
  shake: 16,
  pixel: 17,
  rgb: 18,
  swirl: 19,
};

interface Prog {
  p: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

export class GLRenderer {
  readonly gl: WebGLRenderingContext;
  private quad: WebGLBuffer;
  private trans: Prog;
  private blend: Prog;
  private overlay: Prog;
  private tex: WebGLTexture[] = [];
  lost = false;

  static create(canvas: HTMLCanvasElement, opts: { preserve?: boolean } = {}): GLRenderer | null {
    try {
      const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: !!opts.preserve }) as WebGLRenderingContext | null;
      if (!gl) return null;
      return new GLRenderer(canvas, gl);
    } catch {
      return null;
    }
  }

  private constructor(
    readonly canvas: HTMLCanvasElement,
    gl: WebGLRenderingContext,
  ) {
    this.gl = gl;
    canvas.addEventListener('webglcontextlost', () => (this.lost = true));
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.trans = this.program(VERT, TRANS_FRAG, ['uA', 'uB', 'uRectA', 'uRectB', 'uRes', 'uP', 'uType', 'uSeed']);
    this.blend = this.program(VERT, BLEND_FRAG, ['uA', 'uB', 'uRectA', 'uRectB', 'uRes', 'uMix']);
    this.overlay = this.program(OVERLAY_VERT, OVERLAY_FRAG, ['uA', 'uCenter', 'uHalf', 'uRot', 'uRes', 'uOpacity', 'uKeyOn', 'uKey', 'uSim', 'uSmooth', 'uSpill']);
    for (let i = 0; i < 3; i++) {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      this.tex.push(t);
    }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  private program(vs: string, fs: string, uniforms: string[]): Prog {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error('shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('link: ' + gl.getProgramInfoLog(p));
    const u: Record<string, WebGLUniformLocation | null> = {};
    uniforms.forEach((n) => (u[n] = gl.getUniformLocation(p, n)));
    return { p, u };
  }

  resize(w: number, h: number): void {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /** Загрузить картинку (кадр видео, холст, фото) в слот 0…2 */
  upload(slot: number, src: TexSource): boolean {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + slot);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[slot]);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      return true;
    } catch {
      return false;
    }
  }

  /** Скопировать текстуру слота в другой (для смешивания кадров) — меняем местами ссылки */
  swap(a: number, b: number): void {
    const t = this.tex[a];
    this.tex[a] = this.tex[b];
    this.tex[b] = t;
  }

  clear(): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private bindTex(prog: Prog, name: string, slot: number) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + slot);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[slot]);
    gl.uniform1i(prog.u[name], slot);
  }

  private drawQuad() {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Переход между слотом 0 (уходящий) и слотом 1 (входящий) */
  drawTransition(type: TransitionType, p: number, rectA: Rect, rectB: Rect, seed = 0): boolean {
    const idx = TYPE_INDEX[type];
    if (idx === undefined) return false;
    const gl = this.gl;
    const pr = this.trans;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(pr.p);
    this.bindTex(pr, 'uA', 0);
    this.bindTex(pr, 'uB', 1);
    gl.uniform4fv(pr.u.uRectA, rectA);
    gl.uniform4fv(pr.u.uRectB, rectB);
    gl.uniform2f(pr.u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(pr.u.uP, p);
    gl.uniform1f(pr.u.uType, idx);
    gl.uniform1f(pr.u.uSeed, seed);
    this.drawQuad();
    return true;
  }

  /** Смешать два соседних кадра (слоты 0 и 1) — плавное замедление */
  drawBlend(mix: number, rect: Rect): void {
    const gl = this.gl;
    const pr = this.blend;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(pr.p);
    this.bindTex(pr, 'uA', 0);
    this.bindTex(pr, 'uB', 1);
    gl.uniform4fv(pr.u.uRectA, rect);
    gl.uniform4fv(pr.u.uRectB, rect);
    gl.uniform2f(pr.u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(pr.u.uMix, Math.min(1, Math.max(0, mix)));
    this.drawQuad();
  }

  /** Наложение из слота 2: центр и размер в пикселях холста, поворот в градусах */
  drawOverlay(cx: number, cy: number, w: number, h: number, rotationDeg: number, opacity: number, key: ChromaKey | null): void {
    const gl = this.gl;
    const pr = this.overlay;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(pr.p);
    this.bindTex(pr, 'uA', 2);
    gl.uniform2f(pr.u.uCenter, cx, cy);
    gl.uniform2f(pr.u.uHalf, w / 2, h / 2);
    gl.uniform1f(pr.u.uRot, (rotationDeg * Math.PI) / 180);
    gl.uniform2f(pr.u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(pr.u.uOpacity, opacity);
    gl.uniform1f(pr.u.uKeyOn, key ? 1 : 0);
    if (key) {
      gl.uniform3fv(pr.u.uKey, hexToRgb(key.color));
      gl.uniform1f(pr.u.uSim, key.similarity);
      gl.uniform1f(pr.u.uSmooth, key.smoothness);
      gl.uniform1f(pr.u.uSpill, key.spill);
    }
    this.drawQuad();
    gl.disable(gl.BLEND);
  }
}

/** Цвет фона для хромакея: самый частый оттенок по краям картинки */
export function detectKeyColor(src: CanvasImageSource, w: number, h: number): string {
  const c = document.createElement('canvas');
  const S = 64;
  c.width = S;
  c.height = Math.max(1, Math.round((S * h) / Math.max(1, w)));
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(src, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  const bins = new Map<string, { n: number; r: number; g: number; b: number }>();
  const add = (i: number) => {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const k = `${r >> 5},${g >> 5},${b >> 5}`;
    const e = bins.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++;
    e.r += r;
    e.g += g;
    e.b += b;
    bins.set(k, e);
  };
  for (let px = 0; px < c.width; px++) {
    add(px * 4);
    add(((c.height - 1) * c.width + px) * 4);
  }
  for (let py = 0; py < c.height; py++) {
    add(py * c.width * 4);
    add((py * c.width + c.width - 1) * 4);
  }
  let best = { n: 0, r: 0, g: 255, b: 0 };
  bins.forEach((e) => e.n > best.n && (best = e));
  const hex = (v: number) => Math.round(v / Math.max(1, best.n)).toString(16).padStart(2, '0');
  return best.n ? `#${hex(best.r)}${hex(best.g)}${hex(best.b)}` : '#00ff00';
}
