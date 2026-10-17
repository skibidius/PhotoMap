// Application bootstrap and UI wiring.

import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { listen } from '@tauri-apps/api/event';

import { t, lang, setLang, applyStaticLabels } from './i18n';
import { initTheme, setScheme, setSeed, getPrefs, ACCENT_PRESETS } from './theme';
import {
  initMap,
  setPhotos,
  selectPhoto,
  fitToPhotos,
  setBasemap,
  getBasemap,
  BASEMAPS,
} from './map';
import { initSidebar, render, highlight, clearHighlight, filterPhotos } from './sidebar';
import { initLightbox, open as openLightbox } from './lightbox';
import { exportKml, exportGeoJson, exportScreenshot, copyScreenshot } from './export';
import { initTooltips } from './tooltip';
import { checkForUpdates } from './updater';
import { initContextMenu } from './contextmenu';
import type { Photo, ScanSummary } from './types';

// Import last so its rules win over Leaflet's defaults.
import './styles.css';

const ALBUM_PALETTE = [
  '#1a73e8',
  '#188038',
  '#9334e6',
  '#d93025',
  '#e37400',
  '#007b83',
  '#d01884',
  '#3949ab',
];

let photos: Photo[] = [];
let albumColors = new Map<string, string>();
let currentList: Photo[] = [];
let selectedId: string | null = null;
let filter = '';
let album = 'all';
let sortBy: 'date' | 'name' = 'date';
let showLabels = localStorage.getItem('photomap.labels') === '1';

// DOM
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const importBtn = $('import-btn');
const importMenu = $('import-menu');
const importFolderBtn = $('import-folder');
const importFilesBtn = $('import-files');
const emptyImportBtn = $('empty-import-btn');
const fitBtn = $('fit-btn');
const searchInput = $<HTMLInputElement>('search-input');
const basemapBtn = $('basemap-btn');
const basemapMenu = $('basemap-menu');
const albumFilter = $<HTMLSelectElement>('album-filter');
const sortSelect = $<HTMLSelectElement>('sort-select');
const photoCount = $('photo-count');
const clearBtn = $('clear-btn');
const noResults = $('no-results');
const exportBtn = $('export-btn');
const exportMenu = $('export-menu');
const themeBtn = $('theme-btn');
const themeIcon = $('theme-icon');
const langBtn = $('lang-btn');
const settingsBtn = $('settings-btn');
const settingsPanel = $('settings-panel');
const settingsClose = $('settings-close');
const checkUpdatesBtn = $('check-updates-btn');
const labelsToggle = $<HTMLInputElement>('labels-toggle');
const accentPresets = $('accent-presets');
const accentCustom = $<HTMLInputElement>('accent-custom');
const emptyState = $('empty-state');
const dropOverlay = $('drop-overlay');
const scanOverlay = $('scan-overlay');
const scanText = $('scan-text');
const toastEl = $('toast');

let toastTimer: ReturnType<typeof setTimeout> | undefined;

function toast(msg: string): void {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 3200);
}

function buildAlbums(): void {
  albumColors = new Map();
  let i = 0;
  for (const p of photos) {
    if (!albumColors.has(p.album)) {
      albumColors.set(p.album, ALBUM_PALETTE[i % ALBUM_PALETTE.length]);
      i++;
    }
  }
}

function refreshSidebar(): void {
  currentList = filterPhotos(photos, filter, album, sortBy);
  render(currentList, selectedId);
  const n = currentList.length;
  photoCount.textContent = t(n === 1 ? 'photosCountOne' : 'photosCount', { n });
  noResults.classList.toggle('hidden', currentList.length > 0);
}

function rebuildAlbumFilter(): void {
  const keep = albumFilter.value;
  const names = [...new Set(photos.map((p) => p.album))];
  albumFilter.innerHTML = `<option value="all">${t('allAlbums')}</option>`;
  for (const name of names) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    albumFilter.appendChild(opt);
  }
  if ([...albumFilter.options].some((o) => o.value === keep)) albumFilter.value = keep;
}

function select(id: string, fromMap: boolean): void {
  selectedId = id;
  // Clicking a marker should not move the map (it also keeps spiderfied
  // clusters open); picking from the list should centre it.
  selectPhoto(id, { pan: !fromMap });
  highlight(id, !fromMap);
}

function deselect(): void {
  selectedId = null;
  clearHighlight();
}

function openViewer(id: string): void {
  const idx = currentList.findIndex((p) => p.id === id);
  if (idx >= 0) openLightbox(currentList, idx);
}

function toggleEmptyState(): void {
  emptyState.classList.toggle('hidden', photos.length > 0);
}

function applyLabels(): void {
  document.getElementById('map')?.classList.toggle('show-labels', showLabels);
  if (labelsToggle) labelsToggle.checked = showLabels;
}

async function copyTextToClipboard(text: string): Promise<void> {
  try {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
    await writeText(text);
    toast(t('copied'));
  } catch {
    toast(t('copyError'));
  }
}

function clearAll(): void {
  photos = [];
  album = 'all';
  filter = '';
  searchInput.value = '';
  setPhotoList([]);
  toast(t('cleared'));
}

// --- import ---

async function importFolder(): Promise<void> {
  const selected = await open({ directory: true, multiple: true });
  if (!selected) return;
  const roots = Array.isArray(selected) ? selected : [selected];
  await scan(roots);
}

async function importFiles(): Promise<void> {
  const selected = await open({
    multiple: true,
    filters: [
      {
        name: 'Images',
        extensions: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'tif', 'tiff'],
      },
    ],
  });
  if (!selected) return;
  const roots = Array.isArray(selected) ? selected : [selected];
  await scan(roots);
}

async function scan(roots: string[]): Promise<void> {
  if (roots.length === 0) return;
  scanOverlay.classList.remove('hidden');
  scanText.textContent = t('scanning', { n: 0 });

  const unlisten = await listen('scan-progress', (e) => {
    const p = e.payload as { scanned: number; found: number; current: string };
    scanText.textContent = t('scanning', { n: p.found });
  });

  try {
    const summary = await invoke<ScanSummary>('scan_roots', { roots });
    applySummary(summary);
  } catch {
    toast(t('importError'));
  } finally {
    unlisten();
    scanOverlay.classList.add('hidden');
  }
}

function applySummary(summary: ScanSummary): void {
  // Merge with already imported photos so every folder shows up as an album.
  const merged = new Map(photos.map((p) => [p.id, p]));
  for (const p of summary.photos) merged.set(p.id, p);
  setPhotoList([...merged.values()]);
  if (summary.photos.length === 0) toast(t('scanEmpty'));
  else toast(t('scanDone', { n: summary.photos.length }));
}

function setPhotoList(list: Photo[]): void {
  photos = list;
  selectedId = null;
  buildAlbums();
  rebuildAlbumFilter();
  refreshSidebar();
  setPhotos(photos, albumColors);
  fitToPhotos();
  toggleEmptyState();
}

// --- exports ---

async function runExport(fn: () => Promise<boolean>): Promise<void> {
  exportMenu.classList.add('hidden');
  try {
    const ok = await fn();
    if (ok) toast(t('exported'));
  } catch {
    toast(t('exportError'));
  }
}

// --- theme & language controls ---

function syncControls(): void {
  const scheme = document.documentElement.dataset.scheme;
  themeIcon.textContent = scheme === 'dark' ? 'dark_mode' : 'light_mode';
  langBtn.textContent = lang().toUpperCase();

  document.querySelectorAll<HTMLElement>('.seg[data-scheme]').forEach((b) => {
    b.classList.toggle('active', b.dataset.scheme === getPrefs().scheme);
  });
  document.querySelectorAll<HTMLElement>('.seg[data-lang]').forEach((b) => {
    b.classList.toggle('active', b.dataset.lang === lang());
  });

  document.querySelectorAll<HTMLElement>('#accent-presets .accent-dot').forEach((d) => {
    d.classList.toggle('active', d.dataset.color === getPrefs().seed.toLowerCase());
  });
  accentCustom.value = getPrefs().seed;
}

function populateBasemaps(): void {
  const current = getBasemap().key;
  basemapMenu.innerHTML = '';
  const groups = new Map<string, HTMLDivElement>();

  for (const b of BASEMAPS) {
    const gname = lang() === 'ru' ? b.group.ru : b.group.en;
    let group = groups.get(gname);
    if (!group) {
      const header = document.createElement('div');
      header.className = 'menu-group';
      header.textContent = gname;
      basemapMenu.appendChild(header);
      group = document.createElement('div');
      groups.set(gname, group);
      basemapMenu.appendChild(group);
    }

    const item = document.createElement('button');
    item.className = 'menu-item' + (b.key === current ? ' active' : '');
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', b.key === current ? 'true' : 'false');
    const icon = document.createElement('span');
    icon.className = 'material-symbols-rounded';
    icon.textContent = b.key === current ? 'check' : 'map';
    const label = document.createElement('span');
    label.textContent = lang() === 'ru' ? b.label.ru : b.label.en;
    item.append(icon, label);
    item.addEventListener('click', () => {
      setBasemap(b.key);
      populateBasemaps();
      basemapMenu.classList.add('hidden');
    });
    group.appendChild(item);
  }
}

function renderAccentPresets(): void {
  accentPresets.innerHTML = '';
  for (const c of ACCENT_PRESETS) {
    const b = document.createElement('button');
    b.className = 'accent-dot';
    b.dataset.color = c;
    b.style.background = c;
    b.addEventListener('click', () => {
      setSeed(c);
      syncControls();
    });
    accentPresets.appendChild(b);
  }
}

function applyLanguage(): void {
  applyStaticLabels();
  populateBasemaps();
  rebuildAlbumFilter();
  refreshSidebar();
  syncControls();
}

// --- init ---

function init(): void {
  initTheme();
  initTooltips();

  initMap($('map'), {
    onSelect: (id) => select(id, true),
    onDeselect: () => deselect(),
  });
  initSidebar($('photo-list'), {
    onSelect: (id) => select(id, false),
    onOpen: openViewer,
    onReveal: (id) => void reveal(id),
  });
  initLightbox((id) => void reveal(id));
  initContextMenu(
    (id) => photos.find((p) => p.id === id),
    (text) => void copyTextToClipboard(text),
  );

  emptyImportBtn.addEventListener('click', () => void importFolder());
  fitBtn.addEventListener('click', () => fitToPhotos());
  clearBtn.addEventListener('click', clearAll);

  searchInput.addEventListener('input', () => {
    filter = searchInput.value;
    refreshSidebar();
  });
  albumFilter.addEventListener('change', () => {
    album = albumFilter.value;
    refreshSidebar();
  });
  sortSelect.addEventListener('change', () => {
    sortBy = sortSelect.value === 'name' ? 'name' : 'date';
    refreshSidebar();
  });

  const closeMenus = (): void => {
    exportMenu.classList.add('hidden');
    basemapMenu.classList.add('hidden');
    importMenu.classList.add('hidden');
  };

  const focusFirstItem = (menu: HTMLElement): void => {
    const item =
      menu.querySelector<HTMLElement>('.menu-item.active') ??
      menu.querySelector<HTMLElement>('.menu-item');
    item?.focus();
  };

  basemapBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = basemapMenu.classList.contains('hidden');
    closeMenus();
    if (willOpen) {
      populateBasemaps();
      basemapMenu.classList.remove('hidden');
      focusFirstItem(basemapMenu);
    }
  });

  exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = exportMenu.classList.contains('hidden');
    closeMenus();
    if (willOpen) {
      exportMenu.classList.remove('hidden');
      focusFirstItem(exportMenu);
    }
  });

  importBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = importMenu.classList.contains('hidden');
    closeMenus();
    if (willOpen) {
      importMenu.classList.remove('hidden');
      focusFirstItem(importMenu);
    }
  });

  importFolderBtn.addEventListener('click', () => {
    importMenu.classList.add('hidden');
    void importFolder();
  });
  importFilesBtn.addEventListener('click', () => {
    importMenu.classList.add('hidden');
    void importFiles();
  });

  document.addEventListener('click', closeMenus);
  exportMenu.addEventListener('click', (e) => e.stopPropagation());
  basemapMenu.addEventListener('click', (e) => e.stopPropagation());
  importMenu.addEventListener('click', (e) => e.stopPropagation());

  const menuPairs: Array<{ menu: HTMLElement; trigger: HTMLElement }> = [
    { menu: basemapMenu, trigger: basemapBtn },
    { menu: exportMenu, trigger: exportBtn },
    { menu: importMenu, trigger: importBtn },
  ];
  for (const { menu, trigger } of menuPairs) {
    menu.addEventListener('keydown', (e) => {
      const items = [...menu.querySelectorAll<HTMLElement>('.menu-item')];
      if (items.length === 0) return;
      const idx = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        items[(idx + 1) % items.length].focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        items[(idx - 1 + items.length) % items.length].focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeMenus();
        trigger.focus();
      }
    });
  }
  $('export-kml').addEventListener('click', () => void runExport(() => exportKml(photos)));
  $('export-geojson').addEventListener('click', () => void runExport(() => exportGeoJson(photos)));
  $('export-png').addEventListener('click', () =>
    void runExport(() => exportScreenshot(photos, albumColors, showLabels)),
  );
  $('export-copy').addEventListener('click', async () => {
    exportMenu.classList.add('hidden');
    try {
      const ok = await copyScreenshot(photos, albumColors, showLabels);
      if (ok) toast(t('copied'));
    } catch {
      toast(t('copyError'));
    }
  });

  themeBtn.addEventListener('click', () => {
    const dark = document.documentElement.dataset.scheme === 'dark';
    setScheme(dark ? 'light' : 'dark');
    syncControls();
  });
  langBtn.addEventListener('click', () => {
    setLang(lang() === 'ru' ? 'en' : 'ru');
    applyLanguage();
  });

  settingsBtn.addEventListener('click', () => settingsPanel.classList.remove('hidden'));
  settingsClose.addEventListener('click', () => settingsPanel.classList.add('hidden'));
  checkUpdatesBtn.addEventListener('click', () => void checkForUpdates(false));
  settingsPanel.addEventListener('click', (e) => {
    if (e.target === settingsPanel) settingsPanel.classList.add('hidden');
  });

  document.querySelectorAll<HTMLElement>('.seg[data-scheme]').forEach((b) => {
    b.addEventListener('click', () => {
      setScheme(b.dataset.scheme as 'system' | 'light' | 'dark');
      syncControls();
    });
  });
  document.querySelectorAll<HTMLElement>('.seg[data-lang]').forEach((b) => {
    b.addEventListener('click', () => {
      setLang(b.dataset.lang as 'ru' | 'en');
      applyLanguage();
    });
  });
  accentCustom.addEventListener('input', () => {
    setSeed(accentCustom.value);
    syncControls();
  });

  labelsToggle.addEventListener('change', () => {
    showLabels = labelsToggle.checked;
    localStorage.setItem('photomap.labels', showLabels ? '1' : '0');
    applyLabels();
  });

  renderAccentPresets();
  populateBasemaps();
  applyStaticLabels();
  rebuildAlbumFilter();
  refreshSidebar();
  toggleEmptyState();
  applyLabels();
  syncControls();

  void initDragDrop();

  // Check for updates a moment after startup so the app is interactive first.
  window.setTimeout(() => void checkForUpdates(true), 3000);
}

async function reveal(id: string): Promise<void> {
  const p = photos.find((x) => x.id === id);
  if (!p) return;
  try {
    await invoke('reveal_in_file_manager', { path: p.path });
  } catch {
    /* ignore */
  }
}

async function initDragDrop(): Promise<void> {
  try {
    const wv = getCurrentWebview();
    await wv.onDragDropEvent((event) => {
      const type = event.payload?.type;
      if (type === 'enter' || type === 'over') {
        dropOverlay.classList.remove('hidden');
      } else if (type === 'leave') {
        dropOverlay.classList.add('hidden');
      } else if (type === 'drop') {
        dropOverlay.classList.add('hidden');
        const paths = (event.payload as { paths?: string[] }).paths ?? [];
        if (paths.length) void scan(paths);
      }
    });
  } catch {
    // drag & drop is optional; the Import button always works
  }
}

init();

// Demo dataset for README screenshots only (?demo). Kept out of the main
// bundle via a dynamic import.
if (new URLSearchParams(location.search).has('demo')) {
  void import('./demo').then(({ DEMO_PHOTOS }) => setPhotoList(DEMO_PHOTOS));
}
