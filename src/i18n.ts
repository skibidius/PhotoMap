// Minimal i18n: two dictionaries and a tiny formatter. The active language is
// persisted in localStorage and can be switched at runtime.

export type Lang = 'ru' | 'en';

type Dict = Record<string, string>;

const ru: Dict = {
  import: 'Импорт',
  fit: 'Показать все',
  search: 'Поиск по названию…',
  export: 'Экспорт',
  basemap: 'Подложка',
  exportKml: 'Экспорт KML',
  exportGeoJson: 'Экспорт GeoJSON',
  exportPng: 'Снимок карты (PNG)',
  theme: 'Тема',
  settings: 'Настройки',
  allAlbums: 'Все альбомы',
  sortDate: 'По дате',
  sortName: 'По имени',
  noResults: 'Ничего не найдено',
  emptyTitle: 'Добавьте фотографии',
  emptyText: 'Перетащите сюда папку с фото или нажмите «Импорт». Координаты и направление съёмки читаются из EXIF.',
  dropHint: 'Отпустите, чтобы импортировать',
  themeSystem: 'Системная',
  themeLight: 'Светлая',
  themeDark: 'Тёмная',
  accentColor: 'Акцентный цвет',
  custom: 'Свой',
  language: 'Язык',
  reveal: 'Показать в папке',
  updateAvailable: 'Доступна новая версия {version}. Обновить сейчас?',
  updateNow: 'Обновить',
  later: 'Позже',
  upToDate: 'У вас последняя версия',
  checkUpdates: 'Проверить обновления',
  updates: 'Обновления',
  copyImage: 'Копировать карту',
  copied: 'Скопировано',
  copyError: 'Не удалось скопировать',
  copyCoords: 'Копировать координаты',
  copyLat: 'Копировать широту',
  copyLng: 'Копировать долготу',
  copyMapsLink: 'Копировать ссылку на Google Maps',
  copyName: 'Копировать имя файла',
  display: 'Отображение',
  showLabels: 'Показывать названия фото',
  close: 'Закрыть',
  clear: 'Очистить',
  cleared: 'Список очищен',
  previous: 'Предыдущее',
  next: 'Следующее',
  latitude: 'Широта',
  longitude: 'Долгота',
  altitude: 'Высота',
  azimuth: 'Направление',
  datetime: 'Дата',
  azimuthTrue: 'истинный север',
  azimuthMagnetic: 'магнитный север',
  fov: 'Угол обзора',
  focal: 'Фокусное',
  importFolder: 'Импортировать папку',
  importFiles: 'Импортировать фото',
  noGps: 'без координат',
  photosCount: '{n} фото',
  photosCountOne: '{n} фото',
  scanning: 'Сканирование… найдено {n}',
  scanDone: 'Готово: {n} фото',
  scanEmpty: 'Не найдено фото с GPS-координатами',
  exported: 'Сохранено',
  exportError: 'Ошибка экспорта',
  importError: 'Ошибка импорта',
  legend: 'Легенда',
  north: 'С',
  photos: 'фото',
  album: 'Альбом',
  sortBy: 'Сортировка',
  unsupported: 'Формат не поддерживается для предпросмотра',
};

const en: Dict = {
  import: 'Import',
  fit: 'Fit all',
  search: 'Search by name…',
  export: 'Export',
  basemap: 'Base map',
  exportKml: 'Export KML',
  exportGeoJson: 'Export GeoJSON',
  exportPng: 'Map snapshot (PNG)',
  theme: 'Theme',
  settings: 'Settings',
  allAlbums: 'All albums',
  sortDate: 'By date',
  sortName: 'By name',
  noResults: 'Nothing found',
  emptyTitle: 'Add your photos',
  emptyText: 'Drop a folder here or press Import. Coordinates and shooting direction are read from EXIF.',
  dropHint: 'Drop to import',
  themeSystem: 'System',
  themeLight: 'Light',
  themeDark: 'Dark',
  accentColor: 'Accent color',
  custom: 'Custom',
  language: 'Language',
  reveal: 'Show in folder',
  updateAvailable: 'A new version {version} is available. Update now?',
  updateNow: 'Update',
  later: 'Later',
  upToDate: 'You are up to date',
  checkUpdates: 'Check for updates',
  updates: 'Updates',
  copyImage: 'Copy image',
  copied: 'Copied',
  copyError: 'Copy failed',
  copyCoords: 'Copy coordinates',
  copyLat: 'Copy latitude',
  copyLng: 'Copy longitude',
  copyMapsLink: 'Copy Google Maps link',
  copyName: 'Copy file name',
  display: 'Display',
  showLabels: 'Show photo names',
  close: 'Close',
  clear: 'Clear',
  cleared: 'Cleared',
  previous: 'Previous',
  next: 'Next',
  latitude: 'Latitude',
  longitude: 'Longitude',
  altitude: 'Altitude',
  azimuth: 'Direction',
  datetime: 'Date',
  azimuthTrue: 'true north',
  azimuthMagnetic: 'magnetic north',
  fov: 'Field of view',
  focal: 'Focal length',
  importFolder: 'Import folder',
  importFiles: 'Import photos',
  noGps: 'no coordinates',
  photosCount: '{n} photos',
  photosCountOne: '{n} photo',
  scanning: 'Scanning… found {n}',
  scanDone: 'Done: {n} photos',
  scanEmpty: 'No photos with GPS found',
  exported: 'Saved',
  exportError: 'Export failed',
  importError: 'Import failed',
  legend: 'Legend',
  north: 'N',
  photos: 'photos',
  album: 'Album',
  sortBy: 'Sort',
  unsupported: 'Preview not supported for this format',
};

const dicts: Record<Lang, Dict> = { ru, en };

let current: Lang = loadLang();

function loadLang(): Lang {
  try {
    const saved = localStorage.getItem('photomap.lang');
    if (saved === 'ru' || saved === 'en') return saved;
  } catch {
    /* ignore */
  }
  return navigator.language?.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export function lang(): Lang {
  return current;
}

export function setLang(l: Lang): void {
  current = l;
  try {
    localStorage.setItem('photomap.lang', l);
  } catch {
    /* ignore */
  }
}

/** Translate a key, optionally filling `{name}` placeholders. */
export function t(key: string, params?: Record<string, string | number>): string {
  const d = dicts[current] ?? en;
  let s = d[key] ?? en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(`{${k}}`, String(v));
    }
  }
  return s;
}

/** Apply static labels to all `[data-i18n]`, `[data-i18n-title]` and
 * `[data-i18n-placeholder]` elements. */
export function applyStaticLabels(): void {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n!);
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const text = t(el.dataset.i18nTitle!);
    el.setAttribute('aria-label', text);
    el.removeAttribute('title');
  });
  document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder!);
  });
  document.documentElement.lang = current;
}
