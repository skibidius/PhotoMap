// Sidebar: the searchable, sortable list of photos with lazy-loaded
// thumbnails and two-way selection with the map.

import type { Photo } from './types';
import { t } from './i18n';
import { loadImageUrl, formatCoord, escapeHtml } from './util';

export interface SidebarCallbacks {
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onReveal: (id: string) => void;
}

let cb: SidebarCallbacks = { onSelect: () => {}, onOpen: () => {}, onReveal: () => {} };
let listEl: HTMLElement;
let observer: IntersectionObserver | null = null;

export function initSidebar(el: HTMLElement, callbacks: SidebarCallbacks): void {
  listEl = el;
  cb = callbacks;
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const img = entry.target as HTMLImageElement;
        observer?.unobserve(img);
        const path = img.dataset.src;
        if (!path) continue;
        loadImageUrl(path)
          .then((url) => {
            img.src = url;
          })
          .catch(() => {
            img.classList.add('failed');
          });
      }
    },
    { root: el, rootMargin: '200px' },
  );
}

/** Filter and sort a photo list according to the current sidebar controls. */
export function filterPhotos(
  photos: Photo[],
  filter: string,
  album: string,
  sortBy: 'date' | 'name',
): Photo[] {
  const q = filter.trim().toLowerCase();
  const list = photos.filter((p) => {
    if (album !== 'all' && p.album !== album) return false;
    if (q && !p.name.toLowerCase().includes(q)) return false;
    return true;
  });
  list.sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name, undefined, { numeric: true });
    return (b.datetime ?? '').localeCompare(a.datetime ?? '');
  });
  return list;
}

function itemHtml(p: Photo): string {
  const date = p.datetime?.slice(0, 10) ?? '';
  const dir = p.azimuth != null ? `${p.azimuth.toFixed(0)}°` : '';
  const sub = [date, p.album].filter(Boolean).join(' · ');
  const coords = `${formatCoord(p.latitude)}, ${formatCoord(p.longitude)}${dir ? ' · ' + dir : ''}`;
  const src = p.thumb ?? p.path;
  return `<div class="photo-item" data-id="${p.id}">
    <div class="pi-thumb"><img data-src="${escapeHtml(src)}" alt="" /></div>
    <div class="pi-info">
      <div class="pi-name">${escapeHtml(p.name)}</div>
      <div class="pi-sub">${escapeHtml(sub)}</div>
      <div class="pi-coords">${coords}</div>
    </div>
    <button class="pi-reveal btn btn-icon" data-id="${p.id}" title="${t('reveal')}">
      <span class="material-symbols-rounded">folder_open</span>
    </button>
  </div>`;
}

/** Render an already-filtered and sorted list. */
export function render(list: Photo[], selectedId: string | null): void {
  if (list.length === 0) {
    listEl.innerHTML = '';
    return;
  }

  listEl.innerHTML = list.map(itemHtml).join('');

  listEl.querySelectorAll<HTMLElement>('.photo-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.pi-reveal')) return;
      cb.onSelect(item.dataset.id!);
    });
    item.addEventListener('dblclick', () => cb.onOpen(item.dataset.id!));
  });

  listEl.querySelectorAll<HTMLElement>('.pi-reveal').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      cb.onReveal(btn.dataset.id!);
    });
  });

  listEl.querySelectorAll<HTMLImageElement>('img[data-src]').forEach((img) => {
    observer?.observe(img);
  });

  if (selectedId) highlight(selectedId, false);
}

export function highlight(id: string, scroll = true): void {
  const prev = listEl.querySelector('.photo-item.selected');
  prev?.classList.remove('selected');
  const item = listEl.querySelector<HTMLElement>(`.photo-item[data-id="${id}"]`);
  if (!item) return;
  item.classList.add('selected');
  if (scroll) item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
