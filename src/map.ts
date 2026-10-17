// Leaflet map: tile providers, directional markers, clustering and the
// two-way selection between the map and the sidebar.

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

import type { Photo } from './types';
import { t } from './i18n';
import { loadImageUrl, escapeHtml, formatCoord } from './util';

export interface BasemapDef {
  key: string;
  label: { ru: string; en: string };
  group: { ru: string; en: string };
  url: string;
  subdomains?: string;
  maxZoom: number;
  attribution: string;
}

export const BASEMAPS: BasemapDef[] = [
  {
    key: 'osm',
    label: { ru: 'OpenStreetMap', en: 'OpenStreetMap' },
    group: { ru: 'Открытые', en: 'Open' },
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  },
  {
    key: 'otopo',
    label: { ru: 'OpenTopoMap', en: 'OpenTopoMap' },
    group: { ru: 'Открытые', en: 'Open' },
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    subdomains: 'abc',
    maxZoom: 17,
    attribution: '&copy; OpenStreetMap contributors, &copy; openTopoMap (CC-BY-SA)',
  },
  {
    key: 'yandex-map',
    label: { ru: 'Яндекс — схема', en: 'Yandex — map' },
    group: { ru: 'Яндекс', en: 'Yandex' },
    url: 'https://core-renderer-tiles.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}&scale=1&lang=ru_RU',
    maxZoom: 19,
    attribution: '&copy; Яндекс',
  },
  {
    key: 'yandex-sat',
    label: { ru: 'Яндекс — спутник', en: 'Yandex — satellite' },
    group: { ru: 'Яндекс', en: 'Yandex' },
    url: 'https://core-sat.maps.yandex.net/tiles?l=sat&x={x}&y={y}&z={z}&scale=1&projection=EPSG%3A3395',
    maxZoom: 19,
    attribution: '&copy; Яндекс',
  },
  {
    key: 'yandex-hybrid',
    label: { ru: 'Яндекс — гибрид', en: 'Yandex — hybrid' },
    group: { ru: 'Яндекс', en: 'Yandex' },
    url: 'https://core-sat.maps.yandex.net/tiles?l=sat,skl&x={x}&y={y}&z={z}&scale=1&lang=ru_RU',
    maxZoom: 19,
    attribution: '&copy; Яндекс',
  },
  {
    key: 'google-map',
    label: { ru: 'Google — схема', en: 'Google — map' },
    group: { ru: 'Google', en: 'Google' },
    url: 'https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    subdomains: '0123',
    maxZoom: 20,
    attribution: '&copy; Google',
  },
  {
    key: 'google-sat',
    label: { ru: 'Google — спутник', en: 'Google — satellite' },
    group: { ru: 'Google', en: 'Google' },
    url: 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    subdomains: '0123',
    maxZoom: 20,
    attribution: '&copy; Google',
  },
  {
    key: 'google-hybrid',
    label: { ru: 'Google — гибрид', en: 'Google — hybrid' },
    group: { ru: 'Google', en: 'Google' },
    url: 'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    subdomains: '0123',
    maxZoom: 20,
    attribution: '&copy; Google',
  },
];

const DEFAULT_BASEMAP = 'yandex-map';

let map: L.Map;
let baseLayer: L.TileLayer | null = null;
let cluster: L.MarkerClusterGroup;
let currentBasemap: BasemapDef = BASEMAPS[0];

const markers = new Map<string, L.Marker>();
const photoById = new Map<string, Photo>();
let selectedId: string | null = null;

export interface MapCallbacks {
  onSelect: (id: string) => void;
  onDeselect: () => void;
}

let callbacks: MapCallbacks = { onSelect: () => {}, onDeselect: () => {} };

export function initMap(container: HTMLElement, cbParam: MapCallbacks): void {
  callbacks = cbParam;
  map = L.map(container, {
    zoomControl: true,
    zoomSnap: 1,
    zoomDelta: 1,
    maxZoom: 22,
  }).setView([55.75, 37.62], 5);

  cluster = L.markerClusterGroup({
    maxClusterRadius: 52,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    iconCreateFunction: (c) => {
      const count = c.getChildCount();
      return L.divIcon({
        html: `<div class="cluster"><span>${count}</span></div>`,
        className: 'cluster-icon',
        iconSize: [42, 42],
      });
    },
  });
  map.addLayer(cluster);

  setBasemap(DEFAULT_BASEMAP);
  map.attributionControl.setPrefix('');

  // The map lives inside a flex container; re-lay out tiles whenever its size
  // changes, otherwise tiles can go grey or disappear entirely.
  requestAnimationFrame(() => map.invalidateSize());
  new ResizeObserver(() => map.invalidateSize()).observe(container);

  // Clicking empty map or closing the popup clears the active photo.
  map.on('click', () => {
    if (selectedId) {
      clearSelection();
      callbacks.onDeselect();
    }
  });
  map.on('popupclose', () => {
    if (selectedId) {
      clearSelection();
      callbacks.onDeselect();
    }
  });
}

function conePath(fov: number): string {
  const half = (Math.min(fov, 120) / 2) * (Math.PI / 180);
  const r = 24;
  const lx = 28 - r * Math.sin(half);
  const ly = 28 - r * Math.cos(half);
  const rx = 28 + r * Math.sin(half);
  return `M28 28 L${lx.toFixed(2)} ${ly.toFixed(2)} L${rx.toFixed(2)} ${ly.toFixed(2)} Z`;
}

function markerHtml(color: string, azimuth: number | null, fov: number): string {
  const cone =
    azimuth != null
      ? `<path d="${conePath(fov)}" fill="${color}" fill-opacity="0.28"/>`
      : '';
  return `<div class="pm-marker">
    <svg width="56" height="56" viewBox="0 0 56 56">
      <g transform="rotate(${azimuth ?? 0} 28 28)">${cone}</g>
      <circle class="dot" cx="28" cy="28" r="7.5" fill="${color}" stroke="#fff" stroke-width="2.5"/>
      <circle class="ring" cx="28" cy="28" r="13.5" fill="none" stroke="${color}" stroke-width="3"/>
    </svg>
  </div>`;
}

export function setPhotos(photos: Photo[], colors: Map<string, string>): void {
  photoById.clear();
  markers.clear();
  cluster.clearLayers();

  for (const p of photos) {
    photoById.set(p.id, p);
    const color = colors.get(p.album) ?? '#6750a4';
    const icon = L.divIcon({
      className: 'pm-marker-icon',
      html: markerHtml(color, p.azimuth, p.fov || 55),
      iconSize: [56, 56],
      iconAnchor: [28, 28],
    });
    const marker = L.marker([p.latitude, p.longitude], { icon, title: p.name });
    marker.on('click', () => {
      callbacks.onSelect(p.id);
    });
    markers.set(p.id, marker);
    cluster.addLayer(marker);
  }

  selectedId = null;
}

function popupHtml(p: Photo): string {
  const az = p.azimuth != null ? `${p.azimuth.toFixed(0)}°` : '—';
  const azRef = p.azimuth_ref === 'M' ? ` (${t('azimuthMagnetic')})` : '';
  const focal = p.focal_length_35 ?? p.focal_length;
  const rows = [
    [t('datetime'), p.datetime ?? '—'],
    [t('latitude'), formatCoord(p.latitude)],
    [t('longitude'), formatCoord(p.longitude)],
    [t('azimuth'), az + azRef],
    [t('fov'), p.fov ? `${p.fov.toFixed(0)}°` : '—'],
    [t('focal'), focal != null ? `${focal.toFixed(0)} mm` : '—'],
    [t('altitude'), p.altitude != null ? `${p.altitude.toFixed(0)} m` : '—'],
  ]
    .map(([k, v]) => `<div class="pp-row"><span>${k}</span><b>${escapeHtml(String(v))}</b></div>`)
    .join('');

  return `<div class="popup">
    <button class="popup-close" aria-label="${t('close')}">
      <span class="material-symbols-rounded">close</span>
    </button>
    <div class="pp-img-wrap"><img id="pp-img-${p.id}" class="pp-img" alt="" /></div>
    <div class="pp-title">${escapeHtml(p.name)}</div>
    <div class="pp-meta">${rows}</div>
  </div>`;
}

export function clearSelection(): void {
  if (selectedId) {
    markers.get(selectedId)?.getElement()?.classList.remove('pm-selected');
  }
  selectedId = null;
}

export function selectPhoto(id: string | null, opts: { pan?: boolean } = {}): void {
  clearSelection();
  selectedId = id;
  if (!id) return;

  const marker = markers.get(id);
  const photo = photoById.get(id);
  if (!marker || !photo) return;

  const reveal = (): void => {
    marker.getElement()?.classList.add('pm-selected');
    marker.bindPopup(popupHtml(photo), { closeButton: false, offset: [0, -14] }).openPopup();

    const popupEl = marker.getPopup()?.getElement();
    popupEl?.querySelector('.popup-close')?.addEventListener('click', () => map.closePopup());

    const img = popupEl?.querySelector<HTMLImageElement>('.pp-img') ?? null;
    const tryLoad = (path: string | null): Promise<string> =>
      path ? loadImageUrl(path) : Promise.reject(new Error('no image'));

    // Prefer the cached thumbnail, fall back to the original file.
    tryLoad(photo.thumb)
      .catch(() => tryLoad(photo.path))
      .then((url) => {
        if (img) img.src = url;
      })
      .catch(() => {
        if (img) img.classList.add('failed');
      });
  };

  // If the marker is inside a cluster it has no DOM element yet; zoom in until
  // it becomes visible, then centre it and open its popup.
  if (marker.getElement() == null) {
    cluster.zoomToShowLayer(marker, () => {
      map.panTo(marker.getLatLng(), { animate: true, duration: 0.3 });
      reveal();
    });
    return;
  }

  if (opts.pan !== false) {
    map.panTo(marker.getLatLng(), { animate: true, duration: 0.3 });
  }
  reveal();
}

export function fitToPhotos(): void {
  if (cluster.getLayers().length === 0) return;
  const b = cluster.getBounds();
  if (b.isValid()) map.fitBounds(b, { padding: [48, 48], maxZoom: 16 });
}

export function setBasemap(key: string): void {
  const def = BASEMAPS.find((b) => b.key === key) ?? BASEMAPS[0];
  currentBasemap = def;
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = L.tileLayer(def.url, {
    subdomains: def.subdomains ?? 'abc',
    maxZoom: 22,
    maxNativeZoom: def.maxZoom,
    attribution: def.attribution,
  }).addTo(map);
}

export function getBasemap(): BasemapDef {
  return currentBasemap;
}

export function getMap(): L.Map {
  return map;
}

export function getSelectedId(): string | null {
  return selectedId;
}

export function hasPhotos(): boolean {
  return markers.size > 0;
}
