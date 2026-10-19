// Composite PNG renderer for the current map view: tiles + markers + labels +
// header/legend/scale cards. Platform-independent: the caller supplies a
// `fetchTile` function (native HTTP in Tauri, `fetch` on the web).

import L from 'leaflet';

import type { Photo } from './types';
import { t } from './i18n';
import { getMap, getBasemap } from './map';

export interface SnapshotResult {
  blob: Blob;
  /** Number of tiles that were drawn successfully. */
  tiles: number;
  /** Number of tiles that could not be downloaded (e.g. blocked by CORS). */
  failedTiles: number;
}

type TileJob = { url: string; dx: number; dy: number };

async function pool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  azimuth: number | null,
  fov: number,
  r: number,
): void {
  if (azimuth != null) {
    const half = (Math.min(fov, 120) / 2) * (Math.PI / 180);
    const len = r * 2.7;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((azimuth * Math.PI) / 180);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-len * Math.sin(half), -len * Math.cos(half));
    ctx.lineTo(len * Math.sin(half), -len * Math.cos(half));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.28;
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export async function renderSnapshot(
  photos: Photo[],
  albumColors: Map<string, string>,
  showLabels: boolean,
  fetchTile: (url: string) => Promise<Uint8Array>,
): Promise<SnapshotResult> {
  const map = getMap();
  const basemap = getBasemap();
  const zoom = Math.round(map.getZoom());
  const tileZoom = Math.min(zoom, basemap.maxZoom);
  const tileScale = Math.pow(2, zoom - tileZoom);
  const size = map.getSize();
  const center = map.getCenter();
  const centerWorld = map.project(center, zoom);
  const topLeft = L.point(centerWorld.x - size.x / 2, centerWorld.y - size.y / 2);

  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(size.x * scale);
  canvas.height = Math.round(size.y * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  ctx.fillStyle = '#d8dde3';
  ctx.fillRect(0, 0, size.x, size.y);

  // Theme colors for labels and cards.
  const css = getComputedStyle(document.documentElement);
  const cardBg = css.getPropertyValue('--md-surface-container').trim() || '#ece6f0';
  const onSurface = css.getPropertyValue('--md-on-surface').trim() || '#1d1b20';
  const outline = css.getPropertyValue('--md-outline-variant').trim() || '#cac4d0';

  // --- tiles ---
  const n = Math.pow(2, tileZoom);
  const T = 256 * tileScale;
  const minX = Math.floor(topLeft.x / T);
  const maxX = Math.floor((topLeft.x + size.x) / T);
  const minY = Math.floor(topLeft.y / T);
  const maxY = Math.floor((topLeft.y + size.y) / T);
  const subs = basemap.subdomains ?? 'abc';

  let tiles = 0;
  let failedTiles = 0;

  const buildJobs = (template: string): TileJob[] => {
    const tpl = template.replace('{r}', '');
    const out: TileJob[] = [];
    for (let ty = minY; ty <= maxY; ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = minX; tx <= maxX; tx++) {
        const xx = ((tx % n) + n) % n;
        const url = tpl
          .replace('{z}', String(tileZoom))
          .replace('{x}', String(xx))
          .replace('{y}', String(ty))
          .replace('{s}', subs[(xx + ty) % subs.length]);
        out.push({ url, dx: xx * T - topLeft.x, dy: ty * T - topLeft.y });
      }
    }
    return out;
  };

  const drawTiles = async (jobs: TileJob[]): Promise<void> => {
    await pool(jobs, 8, async (job) => {
      try {
        const bytes = await fetchTile(job.url);
        const bmp = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
        ctx.drawImage(bmp, job.dx, job.dy, T, T);
        bmp.close();
        tiles++;
      } catch {
        failedTiles++;
        /* a failed tile just stays as the background fill */
      }
    });
  };

  await drawTiles(buildJobs(basemap.url));
  if (basemap.overlayUrl) await drawTiles(buildJobs(basemap.overlayUrl));

  // --- markers ---
  for (const p of photos) {
    const pt = map.project([p.latitude, p.longitude], zoom).subtract(topLeft);
    if (pt.x < -40 || pt.y < -40 || pt.x > size.x + 40 || pt.y > size.y + 40) continue;
    const color = albumColors.get(p.album) ?? '#6750a4';
    drawMarker(ctx, pt.x, pt.y, color, p.is_pano ? null : p.azimuth, p.fov || 55, 9);
  }

  // --- labels ---
  if (showLabels) {
    const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
    ctx.font = '500 11px "Google Sans", Roboto, sans-serif';
    for (const p of photos) {
      const pt = map.project([p.latitude, p.longitude], zoom).subtract(topLeft);
      if (pt.x < -40 || pt.y < -40 || pt.x > size.x + 40 || pt.y > size.y + 40) continue;

      let text = baseName(p.name);
      if (text.length > 24) text = `${text.slice(0, 23)}…`;
      const w = ctx.measureText(text).width + 14;
      const h = 20;

      const candidates = [
        { x: pt.x + 14, y: pt.y - h / 2 },
        { x: pt.x - 14 - w, y: pt.y - h / 2 },
        { x: pt.x + 14, y: pt.y + 11 },
        { x: pt.x - 14 - w, y: pt.y + 11 },
      ];

      let rect: { x: number; y: number; w: number; h: number } | null = null;
      for (const c of candidates) {
        const r = { x: c.x, y: c.y, w, h };
        if (r.x < 4 || r.y < 4 || r.x + r.w > size.x - 4 || r.y + r.h > size.y - 4) continue;
        if (!placed.some((q) => overlaps(q, r))) {
          rect = r;
          break;
        }
      }
      if (!rect) continue;

      roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 7);
      ctx.fillStyle = cardBg;
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = onSurface;
      ctx.fillText(text, rect.x + 7, rect.y + 14);
      placed.push(rect);
    }
  }

  // --- header card ---
  const title = `PhotoMap — ${t('photosCount', { n: photos.length })}`;
  const subtitle = new Date().toLocaleString();
  ctx.font = '600 18px "Google Sans", Roboto, sans-serif';
  const titleW = ctx.measureText(title).width;
  ctx.font = '400 13px "Google Sans", Roboto, sans-serif';
  const subW = ctx.measureText(subtitle).width;
  const cardW = Math.max(titleW, subW) + 44;
  roundRect(ctx, 16, 16, cardW, 66, 14);
  ctx.fillStyle = cardBg;
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = onSurface;
  ctx.font = '600 18px "Google Sans", Roboto, sans-serif';
  ctx.fillText(title, 32, 42);
  ctx.font = '400 13px "Google Sans", Roboto, sans-serif';
  ctx.fillStyle = onSurface;
  ctx.globalAlpha = 0.7;
  ctx.fillText(subtitle, 32, 66);
  ctx.globalAlpha = 1;

  // --- legend ---
  const albums = [...albumColors.entries()];
  if (albums.length > 0) {
    const legendTitle = t('legend');
    ctx.font = '600 14px "Google Sans", Roboto, sans-serif';
    const rows = albums.map(([name, color]) => {
      const count = photos.filter((p) => p.album === name).length;
      return { name, color, count };
    });
    const lineH = 24;
    const pad = 14;
    const width = 220;
    const height = pad * 2 + 22 + rows.length * lineH;
    roundRect(ctx, 16, size.y - height - 16, width, height, 14);
    ctx.fillStyle = cardBg;
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = onSurface;
    ctx.fillText(legendTitle, 16 + pad, size.y - height - 16 + pad + 14);
    rows.forEach((r, i) => {
      const y = size.y - height - 16 + pad + 26 + i * lineH + 10;
      ctx.beginPath();
      ctx.arc(16 + pad + 5, y - 4, 5, 0, Math.PI * 2);
      ctx.fillStyle = r.color;
      ctx.fill();
      ctx.font = '400 13px "Google Sans", Roboto, sans-serif';
      ctx.fillStyle = onSurface;
      ctx.fillText(`${r.name} (${r.count})`, 16 + pad + 18, y);
    });
  }

  // --- scale bar (inside a card so it stays readable on any map) ---
  const latRad = (center.lat * Math.PI) / 180;
  const mpp = (156543.03392 * Math.cos(latRad)) / Math.pow(2, zoom);
  const steps = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
  let dist = steps[steps.length - 1];
  for (const s of steps) {
    if (s / mpp >= 60) {
      dist = s;
      break;
    }
  }
  const barW = dist / mpp;
  const label = dist >= 1000 ? `${dist / 1000} km` : `${dist} m`;
  ctx.font = '500 12px "Google Sans", Roboto, sans-serif';
  const labelW = ctx.measureText(label).width;
  const padX = 14;
  const scaleCardW = Math.max(barW, labelW) + padX * 2;
  const scaleCardH = 46;
  const scaleCardX = size.x - scaleCardW - 16;
  const scaleCardY = size.y - scaleCardH - 16;

  roundRect(ctx, scaleCardX, scaleCardY, scaleCardW, scaleCardH, 10);
  ctx.fillStyle = cardBg;
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = 1;
  ctx.stroke();

  const bx = scaleCardX + (scaleCardW - barW) / 2;
  const by = scaleCardY + scaleCardH - 14;
  ctx.strokeStyle = onSurface;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx + barW, by);
  ctx.moveTo(bx, by - 5);
  ctx.lineTo(bx, by + 5);
  ctx.moveTo(bx + barW, by - 5);
  ctx.lineTo(bx + barW, by + 5);
  ctx.stroke();

  ctx.fillStyle = onSurface;
  ctx.fillText(label, scaleCardX + (scaleCardW - labelW) / 2, scaleCardY + 18);

  // --- encode ---
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('canvas encode failed');
  return { blob, tiles, failedTiles };
}
