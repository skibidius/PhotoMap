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
    key: 'carto',
    label: { ru: 'CARTO Voyager', en: 'CARTO Voyager' },
    group: { ru: 'Открытые', en: 'Open' },
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    subdomains: 'abcd',
    maxZoom: 20,
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
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
}

let callbacks: MapCallbacks = { onSelect: () => {} };

export function initMap(container: HTMLElement, cbParam: MapCallbacks): void {
  callbacks = cbParam;
  map = L.map(container, {
    zoomControl: true,
    worldCopyJump: true,
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
}

function markerHtml(color: string, azimuth: number | null): string {
  const cone =
    azimuth != null
      ? `<path d="M28 28 L22.31 6.75 L33.69 6.75 Z" fill="${color}" fill-opacity="0.28"/>`
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
      html: markerHtml(color, p.azimuth),
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
  const rows = [
    [t('datetime'), p.datetime ?? '—'],
    [t('latitude'), formatCoord(p.latitude)],
    [t('longitude'), formatCoord(p.longitude)],
    [t('azimuth'), az + azRef],
    [t('altitude'), p.altitude != null ? `${p.altitude.toFixed(0)} м` : '—'],
  ]
    .map(([k, v]) => `<div class="pp-row"><span>${k}</span><b>${escapeHtml(String(v))}</b></div>`)
    .join('');

  return `<div class="popup">
    <div class="pp-img-wrap"><img id="pp-img-${p.id}" class="pp-img" alt="" /></div>
    <div class="pp-title">${escapeHtml(p.name)}</div>
    <div class="pp-meta">${rows}</div>
  </div>`;
}

export function selectPhoto(id: string | null, opts: { pan?: boolean } = {}): void {
  // Reset previous highlight.
  if (selectedId) {
    markers.get(selectedId)?.getElement()?.classList.remove('pm-selected');
  }
  selectedId = id;
  if (!id) return;

  const marker = markers.get(id);
  const photo = photoById.get(id);
  if (!marker || !photo) return;

  const reveal = (): void => {
    marker.getElement()?.classList.add('pm-selected');
    marker.bindPopup(popupHtml(photo), { closeButton: false, offset: [0, -14] }).openPopup();
    loadImageUrl(photo.thumb ?? photo.path)
      .then((url) => {
        const img = document.getElementById(`pp-img-${photo.id}`) as HTMLImageElement | null;
        if (img) img.src = url;
      })
      .catch(() => {
        /* leave the placeholder empty */
      });
  };

  // If the marker is inside a cluster it has no DOM element yet; zoom in until
  // it becomes visible, then open its popup.
  if (marker.getElement() == null) {
    cluster.zoomToShowLayer(marker, reveal);
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
    maxZoom: def.maxZoom,
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
