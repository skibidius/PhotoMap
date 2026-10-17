// Right-click menu for photos in the sidebar: copy coordinates, a maps link,
// the file name, etc. Styled like the rest of the app's Material menus.

import type { Photo } from './types';
import { t } from './i18n';
import { formatCoord } from './util';

type Entry = { label: string; icon: string; value: string } | 'separator';

let menu: HTMLDivElement | null = null;
let getPhoto: (id: string) => Photo | undefined = () => undefined;
let copy: (text: string) => void = () => {};

export function initContextMenu(
  photoGetter: (id: string) => Photo | undefined,
  copyText: (text: string) => void,
): void {
  getPhoto = photoGetter;
  copy = copyText;

  menu = document.createElement('div');
  menu.id = 'context-menu';
  menu.className = 'context-menu hidden';
  menu.setAttribute('role', 'menu');
  document.body.appendChild(menu);

  document.addEventListener('contextmenu', (e) => {
    const item = (e.target as Element | null)?.closest<HTMLElement>('.photo-item');
    if (!item) return;
    const photo = getPhoto(item.dataset.id ?? '');
    if (!photo) return;
    e.preventDefault();
    open(photo, e.clientX, e.clientY);
  });

  document.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  window.addEventListener('scroll', close, true);
  window.addEventListener('resize', close);
}

function close(): void {
  if (!menu) return;
  menu.classList.add('hidden');
  menu.innerHTML = '';
}

function open(photo: Photo, x: number, y: number): void {
  if (!menu) return;

  const lat = formatCoord(photo.latitude);
  const lng = formatCoord(photo.longitude);
  const entries: Entry[] = [
    { label: t('copyCoords'), icon: 'my_location', value: `${lat}, ${lng}` },
    { label: t('copyLat'), icon: 'north', value: lat },
    { label: t('copyLng'), icon: 'east', value: lng },
    'separator',
    {
      label: t('copyMapsLink'),
      icon: 'map',
      value: `https://www.google.com/maps?q=${lat},${lng}`,
    },
    { label: t('copyName'), icon: 'description', value: photo.name },
  ];

  menu.innerHTML = entries
    .map((entry, i) => {
      if (entry === 'separator') return '<div class="context-sep"></div>';
      return `<button class="menu-item" role="menuitem" data-i="${i}">
        <span class="material-symbols-rounded">${entry.icon}</span>
        <span>${entry.label}</span>
      </button>`;
    })
    .join('');

  menu.querySelectorAll<HTMLButtonElement>('.menu-item').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const entry = entries[Number(btn.dataset.i)];
      if (entry && entry !== 'separator') copy(entry.value);
      close();
    });
  });

  menu.classList.remove('hidden');

  // Clamp to the viewport after measuring.
  const rect = menu.getBoundingClientRect();
  const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  menu.querySelector<HTMLButtonElement>('.menu-item')?.focus();
}
