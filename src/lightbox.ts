// Full-screen photo viewer with EXIF info and keyboard navigation.

import type { Photo } from './types';
import { t } from './i18n';
import { photoSrc, formatCoord, escapeHtml } from './util';

let photos: Photo[] = [];
let index = 0;
let onReveal: (id: string) => void = () => {};

const el = () => document.getElementById('lightbox')!;
const img = () => document.getElementById('lightbox-img') as HTMLImageElement;
const info = () => document.getElementById('lightbox-info')!;

export function initLightbox(reveal: (id: string) => void): void {
  onReveal = reveal;
  document.getElementById('lightbox-close')?.addEventListener('click', close);
  document.getElementById('lightbox-prev')?.addEventListener('click', prev);
  document.getElementById('lightbox-next')?.addEventListener('click', next);
  document.getElementById('lightbox-reveal')?.addEventListener('click', () => {
    const p = photos[index];
    if (p) onReveal(p.id);
  });
  document.addEventListener('keydown', (e) => {
    if (el().classList.contains('hidden')) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') prev();
    else if (e.key === 'ArrowRight') next();
  });
}

export function open(list: Photo[], idx: number): void {
  photos = list;
  index = idx;
  el().classList.remove('hidden');
  show();
}

export function close(): void {
  el().classList.add('hidden');
  img().src = '';
}

function prev(): void {
  if (photos.length === 0) return;
  index = (index - 1 + photos.length) % photos.length;
  show();
}

function next(): void {
  if (photos.length === 0) return;
  index = (index + 1) % photos.length;
  show();
}

function infoHtml(p: Photo): string {
  const parts: string[] = [];
  if (p.datetime) parts.push(p.datetime);
  parts.push(`${formatCoord(p.latitude)}, ${formatCoord(p.longitude)}`);
  if (p.azimuth != null) parts.push(`${t('azimuth')}: ${p.azimuth.toFixed(0)}°`);
  return `<div class="li-name">${escapeHtml(p.name)}</div><div class="li-sub selectable">${parts
    .map(escapeHtml)
    .join(' · ')}</div>`;
}

function show(): void {
  const p = photos[index];
  if (!p) return;
  info().innerHTML = infoHtml(p);
  const image = img();
  image.alt = p.name;
  image.decoding = 'async';
  image.classList.remove('failed');
  image.onerror = () => image.classList.add('failed');
  image.src = photoSrc(p.path);

  // Warm the next photo so flipping through quickly doesn't wait on a decode.
  if (photos.length > 1) {
    const nextPhoto = photos[(index + 1) % photos.length];
    if (nextPhoto) {
      const preload = new Image();
      preload.decoding = 'async';
      preload.src = photoSrc(nextPhoto.path);
    }
  }
}
