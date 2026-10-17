// Leaflet map: tile providers, directional markers, clustering and the
// two-way selection between the map and the sidebar.

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

import type { Photo } from './types';
import { t } from './i18n';
import { photoSrc, escapeHtml, formatCoord } from './util';

export interface BasemapDef {
  key: string;
  label: { ru: string; en: string };
  group: { ru: string; en: string };
  url: string;
  /** Optional transparent overlay drawn on top (e.g. Yandex hybrid labels). */
  overlayUrl?: string;
  subdomains?: string;
  maxZoom: number;
  attribution: string;
  /** Yandex raster tiles are EPSG:3395, everything else is EPSG:3857. */
  crs?: 'EPSG3857' | 'EPSG3395';
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
    crs: 'EPSG3395',
  },
  {
    key: 'yandex-sat',
    label: { ru: 'Яндекс — спутник', en: 'Yandex — satellite' },
    group: { ru: 'Яндекс', en: 'Yandex' },
    url: 'https://core-sat.maps.yandex.net/tiles?l=sat&x={x}&y={y}&z={z}&scale=1&projection=EPSG%3A3395',
    maxZoom: 19,
    attribution: '&copy; Яндекс',
    crs: 'EPSG3395',
  },
  {
    key: 'yandex-hybrid',
    label: { ru: 'Яндекс — гибрид', en: 'Yandex — hybrid' },
    group: { ru: 'Яндекс', en: 'Yandex' },
    url: 'https://core-sat.maps.yandex.net/tiles?l=sat&x={x}&y={y}&z={z}&scale=1',
    overlayUrl:
      'https://core-renderer-tiles.maps.yandex.net/tiles?l=skl&x={x}&y={y}&z={z}&scale=1&lang=ru_RU',
    maxZoom: 19,
    attribution: '&copy; Яндекс',
    crs: 'EPSG3395',
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
let overlayLayer: L.TileLayer | null = null;
let cluster: L.MarkerClusterGroup;
let currentBasemap: BasemapDef = BASEMAPS[0];

const markers = new Map<string, L.Marker>();
const photoById = new Map<string, Photo>();
let selectedId: string | null = null;
let containerEl: HTMLElement;
let currentCrs: 'EPSG3857' | 'EPSG3395' = 'EPSG3857';
let lastPhotos: Photo[] = [];
let lastColors = new Map<string, string>();
let resizeObserver: ResizeObserver | null = null;
let domBound = false;

export interface MapCallbacks {
  onSelect: (id: string) => void;
  onDeselect: () => void;
}

let callbacks: MapCallbacks = { onSelect: () => {}, onDeselect: () => {} };

function crsOf(def: BasemapDef): 'EPSG3857' | 'EPSG3395' {
  return def.crs ?? 'EPSG3857';
}

function leafletCrs(key: 'EPSG3857' | 'EPSG3395'): L.CRS {
  return key === 'EPSG3395' ? L.CRS.EPSG3395 : L.CRS.EPSG3857;
}

function onMapClick(): void {
  if (selectedId) {
    clearSelection();
    callbacks.onDeselect();
  }
}

function createMap(crsKey: 'EPSG3857' | 'EPSG3395'): void {
  currentCrs = crsKey;
  map = L.map(containerEl, {
    crs: leafletCrs(crsKey),
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
  map.attributionControl.setPrefix('');
  map.on('click', onMapClick);
  requestAnimationFrame(() => map.invalidateSize());
  rebuildMarkers();
}

function bindDom(container: HTMLElement): void {
  if (domBound) return;
  domBound = true;

  // Robust marker clicks. Leaflet sometimes swallows a marker click right
  // after a fast drag/pan, so handle clicks in the capture phase and ignore
  // anything that was actually a drag.
  let downX = Number.NaN;
  let downY = Number.NaN;
  container.addEventListener(
    'pointerdown',
    (e) => {
      downX = e.clientX;
      downY = e.clientY;
    },
    true,
  );
  container.addEventListener(
    'click',
    (e) => {
      const dragged =
        Number.isFinite(downX) && Math.hypot(e.clientX - downX, e.clientY - downY) > 6;
      if (dragged) return;
      const el = (e.target as Element | null)?.closest<HTMLElement>('.pm-marker-icon');
      const id = el?.dataset.photoId;
      if (!id) return;
      e.stopPropagation();
      e.preventDefault();
      callbacks.onSelect(id);
    },
    true,
  );
}

export function initMap(container: HTMLElement, cbParam: MapCallbacks): void {
  callbacks = cbParam;
  containerEl = container;
  bindDom(container);

  const def = BASEMAPS.find((b) => b.key === DEFAULT_BASEMAP) ?? BASEMAPS[0];
  createMap(crsOf(def));
  setBasemap(DEFAULT_BASEMAP);

  if (!resizeObserver) {
    resizeObserver = new ResizeObserver(() => map.invalidateSize());
    resizeObserver.observe(container);
  }
}

function conePath(fov: number): string {
  const half = (Math.min(fov, 120) / 2) * (Math.PI / 180);
  const r = 24;
  const lx = 28 - r * Math.sin(half);
  const ly = 28 - r * Math.cos(half);
  const rx = 28 + r * Math.sin(half);
  return `M28 28 L${lx.toFixed(2)} ${ly.toFixed(2)} L${rx.toFixed(2)} ${ly.toFixed(2)} Z`;
}

function markerHtml(color: string, azimuth: number | null, fov: number, name: string): string {
  const cone =
    azimuth != null
      ? `<path d="${conePath(fov)}" fill="${color}" fill-opacity="0.28"/>`
      : '';
  const label = escapeHtml(name.replace(/\.[^.]+$/, ''));
  return `<div class="pm-marker">
    <svg width="56" height="56" viewBox="0 0 56 56">
      <g transform="rotate(${azimuth ?? 0} 28 28)">${cone}</g>
      <circle class="dot" cx="28" cy="28" r="7.5" fill="${color}" stroke="#fff" stroke-width="2.5"/>
      <circle class="ring" cx="28" cy="28" r="13.5" fill="none" stroke="${color}" stroke-width="3"/>
    </svg>
    <span class="pm-label">${label}</span>
  </div>`;
}

function rebuildMarkers(): void {
  photoById.clear();
  markers.clear();
  cluster.clearLayers();

  for (const p of lastPhotos) {
    photoById.set(p.id, p);
    const color = lastColors.get(p.album) ?? '#6750a4';
    const icon = L.divIcon({
      className: 'pm-marker-icon',
      html: markerHtml(color, p.azimuth, p.fov || 55, p.name),
      iconSize: [56, 56],
      iconAnchor: [28, 28],
    });
    const marker = L.marker([p.latitude, p.longitude], { icon, title: p.name });
    marker.on('add', () => {
      marker.getElement()?.setAttribute('data-photo-id', p.id);
    });
    markers.set(p.id, marker);
    cluster.addLayer(marker);
  }
}

export function setPhotos(photos: Photo[], colors: Map<string, string>): void {
  lastPhotos = photos;
  lastColors = colors;
  rebuildMarkers();
  selectedId = null;
}

function popupHtml(p: Photo): string {
  const az = p.azimuth != null ? `${p.azimuth.toFixed(0)}°` : '—';
  const azRef = p.azimuth_ref === 'M' ? ` (${t('azimuthMagnetic')})` : '';
  const focal = p.focal_length_35 ?? p.focal_length;
  const rows = [
    { k: t('datetime'), v: p.datetime ?? '—' },
    { k: t('latitude'), v: formatCoord(p.latitude), sel: true },
    { k: t('longitude'), v: formatCoord(p.longitude), sel: true },
    { k: t('azimuth'), v: az + azRef },
    { k: t('fov'), v: p.fov ? `${p.fov.toFixed(0)}°` : '—' },
    { k: t('focal'), v: focal != null ? `${focal.toFixed(0)} mm` : '—' },
    { k: t('altitude'), v: p.altitude != null ? `${p.altitude.toFixed(0)} m` : '—' },
  ]
    .map(
      (r) =>
        `<div class="pp-row"><span>${r.k}</span><b${r.sel ? ' class="selectable"' : ''}>${escapeHtml(
          String(r.v),
        )}</b></div>`,
    )
    .join('');

  return `<div class="popup">
    <button class="popup-close" aria-label="${t('close')}">
      <span class="material-symbols-rounded">close</span>
    </button>
    <div class="pp-img-wrap"><img id="pp-img-${p.id}" class="pp-img" src="${photoSrc(
      p.thumb ?? p.path,
    )}" alt="" /></div>
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
    marker
      .bindPopup(popupHtml(photo), { closeButton: false, autoPan: false, offset: [0, -14] })
      .openPopup();

    const popupEl = marker.getPopup()?.getElement();
    popupEl?.querySelector('.popup-close')?.addEventListener('click', () => {
      map.closePopup();
      clearSelection();
      callbacks.onDeselect();
    });
    popupEl?.querySelectorAll<HTMLImageElement>('.pp-img').forEach((img) => {
      img.addEventListener('error', () => img.classList.add('failed'));
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
  const newCrs = crsOf(def);

  // Yandex raster tiles use EPSG:3395 while OSM/Google use EPSG:3857. Leaflet
  // fixes the CRS per map, so rebuild the map when the projection changes.
  if (newCrs !== currentCrs) {
    const center = map.getCenter();
    const zoom = map.getZoom();
    if (selectedId) {
      selectedId = null;
      callbacks.onDeselect();
    }
    map.remove();
    baseLayer = null;
    overlayLayer = null;
    createMap(newCrs);
    map.setView(center, zoom, { animate: false });
  } else {
    if (baseLayer) map.removeLayer(baseLayer);
    if (overlayLayer) {
      map.removeLayer(overlayLayer);
      overlayLayer = null;
    }
  }

  currentBasemap = def;

  baseLayer = L.tileLayer(def.url, {
    subdomains: def.subdomains ?? 'abc',
    maxZoom: 22,
    maxNativeZoom: def.maxZoom,
    attribution: def.attribution,
  }).addTo(map);

  if (def.overlayUrl) {
    overlayLayer = L.tileLayer(def.overlayUrl, {
      subdomains: def.subdomains ?? 'abc',
      maxZoom: 22,
      maxNativeZoom: def.maxZoom,
    }).addTo(map);
  }
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
