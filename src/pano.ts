// Interactive 360° equirectangular viewer for the lightbox.
//
// A full-screen WebGL fragment shader turns every screen pixel into a viewing
// direction, so dragging only updates two uniforms — no sphere geometry is
// rebuilt. The texture is downscaled while decoding (at most 4096 px wide),
// which keeps a 14400x7200 DJI panorama inside GPU limits and avoids a ~400 MB
// RGBA upload.

import { t } from './i18n';
import { photoSrc } from './util';

const DEFAULT_FOV = (75 * Math.PI) / 180;
const MIN_FOV = (24 * Math.PI) / 180;
const MAX_FOV = (100 * Math.PI) / 180;
const MAX_PITCH = 1.35;
const AUTO_SPEED = 0.0007;

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uYaw;
uniform float uPitch;
uniform float uFov;
uniform float uAspect;
const float PI = 3.141592653589793;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  p.x *= uAspect;
  float tanF = tan(uFov * 0.5);
  vec3 d = normalize(vec3(p.x * tanF, p.y * tanF, 1.0));

  float cp = cos(uPitch);
  float sp = sin(uPitch);
  d = vec3(d.x, d.y * cp + d.z * sp, d.z * cp - d.y * sp);

  float cy = cos(uYaw);
  float sy = sin(uYaw);
  d = vec3(d.x * cy + d.z * sy, d.y, d.z * cy - d.x * sy);

  float lon = atan(d.x, d.z);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  vec2 uv = vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI);
  gl_FragColor = vec4(texture2D(uTex, uv).rgb, 1.0);
}`;

let host: HTMLElement | null = null;
let canvas: HTMLCanvasElement | null = null;
let hint: HTMLElement | null = null;
let gl: WebGLRenderingContext | null = null;
let program: WebGLProgram | null = null;
let texture: WebGLTexture | null = null;
let uYaw: WebGLUniformLocation | null = null;
let uPitch: WebGLUniformLocation | null = null;
let uFov: WebGLUniformLocation | null = null;
let uAspect: WebGLUniformLocation | null = null;

let active = false;
let raf = 0;
let token = 0;
let dragging = false;
let pointers = new Map<number, { x: number; y: number }>();
let lastX = 0;
let lastY = 0;
let velX = 0;
let velY = 0;
let pinchDist = 0;
let yaw = 0;
let pitch = 0;
let fov = DEFAULT_FOV;
let autoRotate = true;

/** Optional platform loader. The desktop app returns a downscaled JPEG from
 * Rust; the web build leaves it unset and fetches the object URL directly. */
export type PanoLoader = (path: string, maxWidth: number) => Promise<Blob | null>;
let loader: PanoLoader | null = null;

export function setPanoLoader(fn: PanoLoader): void {
  loader = fn;
}

function compile(g: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = g.createShader(type);
  if (!shader) return null;
  g.shaderSource(shader, source);
  g.compileShader(shader);
  if (!g.getShaderParameter(shader, g.COMPILE_STATUS)) {
    console.error('pano shader:', g.getShaderInfoLog(shader));
    g.deleteShader(shader);
    return null;
  }
  return shader;
}

function setup(): boolean {
  host = document.getElementById('pano-view');
  canvas = document.getElementById('pano-canvas') as HTMLCanvasElement | null;
  hint = document.getElementById('pano-hint');
  if (!host || !canvas) return false;

  gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    powerPreference: 'high-performance',
  }) as WebGLRenderingContext | null;
  if (!gl) return false;

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return false;

  program = gl.createProgram();
  if (!program) return false;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('pano link:', gl.getProgramInfoLog(program));
    return false;
  }

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  uYaw = gl.getUniformLocation(program, 'uYaw');
  uPitch = gl.getUniformLocation(program, 'uPitch');
  uFov = gl.getUniformLocation(program, 'uFov');
  uAspect = gl.getUniformLocation(program, 'uAspect');
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, 'uTex'), 0);

  bindPointerEvents();
  new ResizeObserver(() => resize()).observe(canvas);
  return true;
}

export function initPanoViewer(): void {
  if (host) return;
  setup();
}

function resize(): void {
  if (!canvas || !gl) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  gl.viewport(0, 0, w, h);
}

function hideHint(): void {
  autoRotate = false;
  hint?.classList.add('hidden');
}

function bindPointerEvents(): void {
  const el = host;
  const cnv = canvas;
  if (!el || !cnv) return;

  const pointerDistance = (): number => {
    const pts = [...pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  };

  el.addEventListener('pointerdown', (e) => {
    if (!active) return;
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    hideHint();
    if (pointers.size === 1) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      velX = 0;
      velY = 0;
      el.classList.add('active');
    } else {
      pinchDist = pointerDistance();
    }
    e.preventDefault();
  });

  el.addEventListener('pointermove', (e) => {
    if (!active || !pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size >= 2) {
      const d = pointerDistance();
      if (pinchDist > 0 && d > 0) {
        fov = Math.min(MAX_FOV, Math.max(MIN_FOV, (fov * pinchDist) / d));
      }
      pinchDist = d;
      return;
    }

    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    const k = fov / Math.max(1, cnv.clientHeight);
    yaw -= dx * k;
    pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, pitch + dy * k));
    velX = -dx * k * 0.12;
    velY = dy * k * 0.12;
  });

  const end = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      dragging = false;
      el.classList.remove('active');
    } else if (pointers.size === 1) {
      const remaining = [...pointers.values()][0];
      lastX = remaining.x;
      lastY = remaining.y;
      pinchDist = 0;
    }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  el.addEventListener(
    'wheel',
    (e) => {
      if (!active) return;
      e.preventDefault();
      hideHint();
      fov = Math.min(MAX_FOV, Math.max(MIN_FOV, fov * (e.deltaY > 0 ? 1.08 : 0.92)));
    },
    { passive: false },
  );

  el.addEventListener('dblclick', () => {
    yaw = 0;
    pitch = 0;
    fov = DEFAULT_FOV;
  });
}

async function loadViaImage(url: string, targetW: number): Promise<ImageBitmap | null> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  const ok = await new Promise<boolean>((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
  if (!ok || !img.naturalWidth || !img.naturalHeight) return null;

  const scale = Math.min(1, targetW / img.naturalWidth);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  try {
    return await createImageBitmap(c);
  } catch {
    return null;
  }
}

async function bitmapFromBlob(blob: Blob, width: number): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(blob, {
      resizeWidth: width,
      resizeQuality: 'high',
      imageOrientation: 'from-image',
    });
  } catch {
    return null;
  }
}

async function fetchBlob(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

async function applyTexture(bmp: ImageBitmap, maxTex: number): Promise<boolean> {
  if (!gl) {
    bmp.close();
    return false;
  }

  let upload = bmp;
  if (bmp.width > maxTex || bmp.height > maxTex) {
    // Some browsers ignore the one-sided resize option. Never upload a
    // 14400 px texture: downscale it on a canvas first.
    const scale = Math.min(maxTex / bmp.width, maxTex / bmp.height);
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) {
      bmp.close();
      return false;
    }
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const smaller = await createImageBitmap(c);
    if (!smaller) return false;
    upload = smaller;
  }

  const tex = gl.createTexture();
  if (!tex) {
    upload.close();
    return false;
  }
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, upload);

  // WebGL1 only allows REPEAT and mipmaps on power-of-two textures. A normal
  // equirectangular panorama gives us 8192x4096; a cropped one falls back to
  // CLAMP + linear filtering. Mipmaps remove shimmer when zoomed out and
  // anisotropic filtering keeps oblique views sharp.
  const isPow2 = (n: number): boolean => (n & (n - 1)) === 0;
  const pot = isPow2(upload.width) && isPow2(upload.height);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, pot ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (pot) {
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  } else {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const aniso = gl.getExtension('EXT_texture_filter_anisotropic') as {
    TEXTURE_MAX_ANISOTROPY_EXT: number;
    MAX_TEXTURE_MAX_ANISOTROPY_EXT: number;
  } | null;
  if (aniso) {
    const max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
    gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
  }

  if (texture) gl.deleteTexture(texture);
  texture = tex;
  if (canvas) {
    // Useful for diagnostics (and verifying progressive loading).
    canvas.dataset.texWidth = String(upload.width);
    canvas.dataset.texHeight = String(upload.height);
  }
  upload.close();
  return true;
}

async function loadPanorama(path: string, myToken: number): Promise<boolean> {
  if (!gl) return false;
  const maxTex = (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) || 4096;
  const ua = navigator.userAgent;
  const isMobile =
    /Android|iPhone|iPad|iPod/i.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const highW = Math.min(isMobile ? 4096 : 8192, maxTex);
  const baseW = Math.min(4096, highW);

  // The web fetches the original once and decodes both sizes from it; the
  // desktop loader asks Rust for a downscaled JPEG at each size.
  const source = loader ? null : await fetchBlob(photoSrc(path));

  const loadBitmap = async (width: number): Promise<ImageBitmap | null> => {
    if (loader) {
      const blob = await loader(path, width);
      return blob ? bitmapFromBlob(blob, width) : null;
    }
    if (source) return bitmapFromBlob(source, width);
    return null;
  };

  let base: ImageBitmap | null = null;
  try {
    base = await loadBitmap(baseW);
  } catch {
    base = null;
  }
  if (!base) base = await loadViaImage(photoSrc(path), baseW);
  if (!base) return false;
  if (myToken !== token || !active) {
    base.close();
    return false;
  }
  if (!(await applyTexture(base, maxTex))) return false;

  // Upgrade to the high-resolution texture in the background; the base view
  // is already interactive while this decodes and uploads.
  if (highW > baseW) {
    void (async () => {
      try {
        const high = await loadBitmap(highW);
        if (!high) return;
        if (myToken !== token || !active) {
          high.close();
          return;
        }
        await applyTexture(high, maxTex);
      } catch {
        /* keep the base texture */
      }
    })();
  }
  return true;
}

function draw(): void {
  if (!gl || !program || !texture || !canvas) return;
  gl.useProgram(program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1f(uYaw, yaw);
  gl.uniform1f(uPitch, pitch);
  gl.uniform1f(uFov, fov);
  gl.uniform1f(uAspect, canvas.width / Math.max(1, canvas.height));
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function frame(): void {
  if (!active || !gl || !program) {
    raf = 0;
    return;
  }
  if (!dragging) {
    if (autoRotate) yaw += AUTO_SPEED;
    yaw += velX;
    pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, pitch + velY));
    velX *= 0.92;
    velY *= 0.92;
    if (Math.abs(velX) < 1e-5) velX = 0;
    if (Math.abs(velY) < 1e-5) velY = 0;
  }
  draw();
  raf = requestAnimationFrame(frame);
}

function start(): void {
  if (!raf) raf = requestAnimationFrame(frame);
}

/** Show a panorama from a photo path. Resolves `false` when WebGL or the
 * image is unavailable. */
export async function openPanorama(path: string): Promise<boolean> {
  if (!host || !gl) return false;

  const my = ++token;
  active = true;
  yaw = 0;
  pitch = 0;
  fov = DEFAULT_FOV;
  autoRotate = true;
  velX = 0;
  velY = 0;
  dragging = false;
  pointers.clear();
  host.classList.remove('active');

  const ok = await loadPanorama(path, my);
  if (!ok || my !== token) return false;
  if (!active) return false;

  if (hint) {
    hint.textContent = t('panoHint');
    hint.classList.remove('hidden');
  }
  host.classList.remove('hidden');
  resize();
  start();
  return true;
}

export function closePanorama(): void {
  active = false;
  token++;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  dragging = false;
  pointers.clear();
  host?.classList.remove('active');
  host?.classList.add('hidden');
  hint?.classList.add('hidden');
  if (texture && gl) {
    gl.deleteTexture(texture);
    texture = null;
  }
}
