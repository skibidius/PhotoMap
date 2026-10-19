// Full-screen photo viewer with EXIF info and keyboard navigation.

import type { Photo } from './types';
import { t } from './i18n';
import { photoSrc, formatCoord, escapeHtml } from './util';
import { initPanoViewer, openPanorama, closePanorama } from './pano';

let photos: Photo[] = [];
let index = 0;
let onReveal: (id: string) => void = () => {};

const el = () => document.getElementById('lightbox')!;
const img = () => document.getElementById('lightbox-img') as HTMLImageElement;
const info = () => document.getElementById('lightbox-info')!;

export function initLightbox(reveal: (id: string) => void): void {
  onReveal = reveal;
  initPanoViewer();
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
  closePanorama();
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
  if (p.is_pano) parts.push(t('panorama'));
  if (p.datetime) parts.push(p.datetime);
  parts.push(`${formatCoord(p.latitude)}, ${formatCoord(p.longitude)}`);
  if (p.azimuth != null) parts.push(`${t('azimuth')}: ${p.azimuth.toFixed(0)}°`);
  const badge = p.is_pano ? ' <span class="pano-badge">360°</span>' : '';
  return `<div class="li-name">${escapeHtml(p.name)}${badge}</div><div class="li-sub selectable">${parts
    .map(escapeHtml)
    .join(' · ')}</div>`;
}

function isEquirect(width: number, height: number): boolean {
  if (!width || !height) return false;
  const ratio = width / height;
  return width >= 4096 && ratio > 1.9 && ratio < 2.1;
}

function show(): void {
  const p = photos[index];
  if (!p) return;
  info().innerHTML = infoHtml(p);
  const image = img();
  image.alt = p.name;
  image.decoding = 'async';
  image.classList.remove('failed');
  image.onload = null;
  image.onerror = () => image.classList.add('failed');

  const url = photoSrc(p.path);
  const preview = photoSrc(p.thumb ?? p.path);

  if (p.is_pano === true) {
    // Keep a cheap thumbnail on screen while the big panorama is decoded and
    // uploaded as a WebGL texture.
    image.classList.remove('hidden');
    image.src = preview;
    void openPanorama(p.path).then((ok) => {
      if (photos[index] !== p) return;
      if (ok) {
        image.classList.add('hidden');
      } else {
        image.classList.remove('hidden');
        image.src = url;
      }
    });
    return;
  }

  closePanorama();
  image.classList.remove('hidden');
  image.onload = () => {
    // Legacy data without is_pano: a huge 2:1 image is almost certainly a
    // full equirectangular panorama.
    if (p.is_pano === undefined && isEquirect(image.naturalWidth, image.naturalHeight)) {
      image.classList.add('hidden');
      void openPanorama(p.path).then((ok) => {
        if (photos[index] !== p) return;
        if (!ok) {
          image.classList.remove('hidden');
          image.src = url;
        }
      });
    }
  };
  image.src = url;

  // Warm the next photo so flipping through quickly doesn't wait on a decode.
  // Panoramas are decoded by the 360° viewer instead, not as a plain <img>.
  if (photos.length > 1) {
    const nextPhoto = photos[(index + 1) % photos.length];
    if (nextPhoto && nextPhoto.is_pano !== true) {
      const preload = new Image();
      preload.decoding = 'async';
      preload.src = photoSrc(nextPhoto.path);
    }
  }
}
