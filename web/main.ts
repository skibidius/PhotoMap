// PhotoMap — web build. Same UI as the desktop app, but photos are picked in
// the browser, EXIF is parsed locally with exifr and files never leave the tab.

import '../src/fonts.css';

import { t, lang, setLang, applyStaticLabels } from '../src/i18n';
import { initTheme, setScheme, setSeed, getPrefs, ACCENT_PRESETS } from '../src/theme';
import {
  initMap,
  setPhotos,
  selectPhoto,
  fitToPhotos,
  setBasemap,
  getBasemap,
  BASEMAPS,
} from '../src/map';
import { initSidebar, render, highlight, clearHighlight, filterPhotos } from '../src/sidebar';
import { initLightbox, open as openLightbox } from '../src/lightbox';
import { initTooltips } from '../src/tooltip';
import { initContextMenu } from '../src/contextmenu';
import { exportKml, exportGeoJson, exportScreenshot, copyScreenshot } from './export';
import {
  collectDropItems,
  isImageFile,
  itemsFromFiles,
  scanImportItems,
  type ImportItem,
  type ScanResult,
} from './photos';
import type { Photo } from '../src/types';
import appIcon from '../src/assets/app-icon.png';

// Import last so its rules win over Leaflet's defaults.
import '../src/styles.css';

declare const __APP_VERSION__: string;

const SUPPORT_URL = 'https://pay.cloudtips.ru/p/6b424301';

const PAGE_TITLE: Record<'ru' | 'en', string> = {
  ru: 'PhotoMap — фотографии на карте по GPS и EXIF',
  en: 'PhotoMap — geotagged photos on a map',
};

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
let importing = false;
let searchTimer: ReturnType<typeof setTimeout> | undefined;

// DOM
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const importBtn = $('import-btn');
const menuBtn = $('menu-btn');
const mainEl = $('main');
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
const supportBtn = $('support-btn');
const labelsToggle = $<HTMLInputElement>('labels-toggle');
const aboutPanel = $('about-panel');
const aboutBtn = $('about-btn');
const aboutClose = $('about-close');
const aboutVersion = $('about-version');
const aboutGithub = $('about-github');
const aboutLogo = $<HTMLImageElement>('about-logo');
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
  noResults.classList.toggle('hidden', currentList.length > 0 || photos.length === 0);
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
  mainEl.classList.remove('sidebar-open');
  selectPhoto(id, { pan: !fromMap });
  highlight(id, true);
}

function deselect(): void {
  selectedId = null;
  clearHighlight();
  mainEl.classList.remove('sidebar-open');
}

function openViewer(id: string): void {
  let list = currentList;
  let idx = list.findIndex((p) => p.id === id);
  if (idx < 0) {
    list = photos;
    idx = photos.findIndex((p) => p.id === id);
  }
  if (idx >= 0) openLightbox(list, idx);
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
    await navigator.clipboard.writeText(text);
    toast(t('copied'));
    return;
  } catch {
    /* older browsers / non-secure contexts */
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    toast(t('copied'));
  } catch {
    toast(t('copyError'));
  }
  ta.remove();
}

function clearAll(): void {
  for (const p of photos) {
    for (const u of new Set([p.path, p.thumb])) {
      if (u && u.startsWith('blob:')) URL.revokeObjectURL(u);
    }
  }
  photos = [];
  album = 'all';
  filter = '';
  searchInput.value = '';
  setPhotoList([]);
  toast(t('cleared'));
}

// --- import ---

function pickFiles(options: { folder: boolean }): void {
  if (importing) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = 'image/*';
  if (options.folder) {
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
  }
  input.addEventListener('change', () => {
    const files = input.files ? [...input.files] : [];
    if (files.length > 0) void importItems(itemsFromFiles(files));
  });
  input.click();
}

async function importItems(items: ImportItem[]): Promise<void> {
  const files = items.filter((i) => isImageFile(i.file));
  if (files.length === 0 || importing) return;

  importing = true;
  scanOverlay.classList.remove('hidden');
  scanText.textContent = t('scanningProgress', { done: 0, total: files.length });

  try {
    // Let the overlay paint before the EXIF pass starts.
    await new Promise((resolve) => setTimeout(resolve, 30));
    const result = await scanImportItems(
      files,
      new Set(photos.map((p) => p.id)),
      (done, _found, total) => {
        scanText.textContent = t('scanningProgress', { done, total });
      },
    );
    applySummary(result);
  } catch {
    toast(t('importError'));
  } finally {
    importing = false;
    scanOverlay.classList.add('hidden');
  }
}

function applySummary(summary: ScanResult): void {
  const merged = new Map(photos.map((p) => [p.id, p]));
  for (const p of summary.photos) {
    const old = merged.get(p.id);
    if (old) {
      for (const u of new Set([old.path, old.thumb])) {
        if (u && u.startsWith('blob:') && u !== p.path && u !== p.thumb) {
          URL.revokeObjectURL(u);
        }
      }
    }
    merged.set(p.id, p);
  }
  setPhotoList([...merged.values()]);
  if (summary.photos.length > 0) toast(t('scanDone', { n: summary.photos.length }));
  else if (summary.skipped > 0) toast(t('nothingNew'));
  else toast(t('scanEmpty'));
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
  } catch (e) {
    if ((e as Error)?.message === 'tiles-blocked') toast(t('tilesBlocked'));
    else toast(t('exportError'));
  }
}

// --- theme & language controls ---

function syncControls(): void {
  const scheme = document.documentElement.dataset.scheme;
  themeIcon.textContent = scheme === 'dark' ? 'dark_mode' : 'light_mode';
  langBtn.textContent = lang().toUpperCase();
  langBtn.setAttribute('aria-label', `${t('language')}: ${lang().toUpperCase()}`);

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
  document.title = PAGE_TITLE[lang()];
  populateBasemaps();
  rebuildAlbumFilter();
  refreshSidebar();
  syncControls();
}

// --- init ---

function init(): void {
  document.documentElement.classList.add('web');

  initTheme();
  initTooltips();

  initMap($('map'), {
    onSelect: (id) => select(id, true),
    onDeselect: () => deselect(),
    onOpen: (id) => openViewer(id),
  });
  // OSM is the safest default for the web build: it allows CORS, so the PNG
  // snapshot works too.
  setBasemap('osm');

  initSidebar($('photo-list'), {
    onSelect: (id) => select(id, false),
    onOpen: openViewer,
    onReveal: () => {},
  });
  initLightbox(() => {});
  initContextMenu(
    (id) => photos.find((p) => p.id === id),
    (text) => void copyTextToClipboard(text),
  );

  emptyImportBtn.addEventListener('click', () => pickFiles({ folder: true }));
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    mainEl.classList.toggle('sidebar-open');
  });
  fitBtn.addEventListener('click', () => fitToPhotos());
  clearBtn.addEventListener('click', clearAll);

  searchInput.addEventListener('input', () => {
    filter = searchInput.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => refreshSidebar(), 140);
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
    pickFiles({ folder: true });
  });
  importFilesBtn.addEventListener('click', () => {
    importMenu.classList.add('hidden');
    pickFiles({ folder: false });
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
      if (ok) toast(t('mapCopied'));
    } catch (e) {
      if ((e as Error)?.message === 'tiles-blocked') toast(t('tilesBlocked'));
      else toast(t('copyError'));
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
  settingsPanel.addEventListener('click', (e) => {
    if (e.target === settingsPanel) settingsPanel.classList.add('hidden');
  });

  supportBtn.addEventListener('click', () => {
    window.open(SUPPORT_URL, '_blank', 'noopener');
  });

  // The web build has no auto-updater; hide the update section.
  $('check-updates-btn').closest('.settings-section')?.classList.add('hidden');

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

  aboutLogo.src = appIcon;
  aboutBtn.addEventListener('click', () => {
    aboutVersion.textContent = `${t('version')} ${__APP_VERSION__}`;
    aboutPanel.classList.remove('hidden');
  });
  aboutClose.addEventListener('click', () => aboutPanel.classList.add('hidden'));
  aboutPanel.addEventListener('click', (e) => {
    if (e.target === aboutPanel) aboutPanel.classList.add('hidden');
  });
  aboutGithub.addEventListener('click', () => {
    window.open('https://github.com/skibidius/PhotoMap', '_blank', 'noopener');
  });

  renderAccentPresets();
  populateBasemaps();
  applyStaticLabels();
  document.title = PAGE_TITLE[lang()];
  rebuildAlbumFilter();
  refreshSidebar();
  toggleEmptyState();
  applyLabels();
  syncControls();

  initDragDrop();
}

function initDragDrop(): void {
  let depth = 0;

  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    depth++;
    dropOverlay.classList.remove('hidden');
  });
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    depth = Math.max(0, depth - 1);
    if (depth === 0) dropOverlay.classList.add('hidden');
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    dropOverlay.classList.add('hidden');
    if (!e.dataTransfer) return;
    void collectDropItems(e.dataTransfer).then((items) => importItems(items));
  });
}

init();

// Demo dataset for README screenshots only (?demo). Kept out of the main
// bundle via a dynamic import.
if (new URLSearchParams(location.search).has('demo')) {
  void import('../src/demo').then(({ DEMO_PHOTOS }) => setPhotoList(DEMO_PHOTOS));
}
