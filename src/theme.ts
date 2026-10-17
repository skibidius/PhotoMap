// Material You theming built on Google's official material-color-utilities.
// A seed color is turned into a full tonal palette + light/dark schemes, which
// are then exposed as CSS custom properties.

import { themeFromSourceColor, argbFromHex, hexFromArgb } from '@material/material-color-utilities';

export type SchemeName = 'system' | 'light' | 'dark';

export interface ThemePrefs {
  seed: string;
  scheme: SchemeName;
}

export const ACCENT_PRESETS = [
  '#1a73e8',
  '#6750a4',
  '#006c4c',
  '#b3261e',
  '#7d5260',
  '#006a6a',
  '#825500',
  '#f47735',
];

const VAR_MAP: Array<[string, string]> = [
  ['primary', '--md-primary'],
  ['onPrimary', '--md-on-primary'],
  ['primaryContainer', '--md-primary-container'],
  ['onPrimaryContainer', '--md-on-primary-container'],
  ['secondary', '--md-secondary'],
  ['onSecondary', '--md-on-secondary'],
  ['secondaryContainer', '--md-secondary-container'],
  ['onSecondaryContainer', '--md-on-secondary-container'],
  ['tertiary', '--md-tertiary'],
  ['onTertiary', '--md-on-tertiary'],
  ['tertiaryContainer', '--md-tertiary-container'],
  ['onTertiaryContainer', '--md-on-tertiary-container'],
  ['error', '--md-error'],
  ['onError', '--md-on-error'],
  ['errorContainer', '--md-error-container'],
  ['onErrorContainer', '--md-on-error-container'],
  ['background', '--md-background'],
  ['onBackground', '--md-on-background'],
  ['surface', '--md-surface'],
  ['onSurface', '--md-on-surface'],
  ['surfaceVariant', '--md-surface-variant'],
  ['onSurfaceVariant', '--md-on-surface-variant'],
  ['outline', '--md-outline'],
  ['outlineVariant', '--md-outline-variant'],
  ['shadow', '--md-shadow'],
  ['scrim', '--md-scrim'],
  ['inverseSurface', '--md-inverse-surface'],
  ['inverseOnSurface', '--md-inverse-on-surface'],
  ['inversePrimary', '--md-inverse-primary'],
  ['surfaceDim', '--md-surface-dim'],
  ['surfaceBright', '--md-surface-bright'],
  ['surfaceContainerLowest', '--md-surface-container-lowest'],
  ['surfaceContainerLow', '--md-surface-container-low'],
  ['surfaceContainer', '--md-surface-container'],
  ['surfaceContainerHigh', '--md-surface-container-high'],
  ['surfaceContainerHighest', '--md-surface-container-highest'],
];

// Neutral surfaces in the spirit of Google's own apps: white / light grey in
// light mode, near-black greys in dark mode. Accent colors still come from the
// seed, but the chrome stays neutral instead of picking up a strong tint.
const NEUTRAL: Record<'light' | 'dark', Record<string, string>> = {
  light: {
    background: '#ffffff',
    surface: '#ffffff',
    surfaceContainerLowest: '#ffffff',
    surfaceContainerLow: '#f8f9fa',
    surfaceContainer: '#f1f3f4',
    surfaceContainerHigh: '#e8eaed',
    surfaceContainerHighest: '#e0e2e6',
    onSurface: '#1f1f1f',
    onBackground: '#1f1f1f',
    onSurfaceVariant: '#5f6368',
    surfaceVariant: '#f1f3f4',
    outline: '#80868b',
    outlineVariant: '#dadce0',
    surfaceDim: '#dee1e3',
    surfaceBright: '#ffffff',
    inverseSurface: '#303134',
    inverseOnSurface: '#f8f9fa',
  },
  dark: {
    background: '#131314',
    surface: '#131314',
    surfaceContainerLowest: '#0e0e0f',
    surfaceContainerLow: '#1b1b1c',
    surfaceContainer: '#1f1f20',
    surfaceContainerHigh: '#292a2b',
    surfaceContainerHighest: '#343536',
    onSurface: '#e3e3e3',
    onBackground: '#e3e3e3',
    onSurfaceVariant: '#c4c7c5',
    surfaceVariant: '#444746',
    outline: '#8e918f',
    outlineVariant: '#444746',
    surfaceDim: '#131314',
    surfaceBright: '#3a3b3c',
    inverseSurface: '#e3e3e3',
    inverseOnSurface: '#303134',
  },
};

let prefs: ThemePrefs = loadPrefs();
let media: MediaQueryList | null = null;

function loadPrefs(): ThemePrefs {
  let seed = '#1a73e8';
  let scheme: SchemeName = 'system';
  try {
    const raw = localStorage.getItem('photomap.theme');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.seed) seed = parsed.seed;
      if (parsed.scheme === 'light' || parsed.scheme === 'dark' || parsed.scheme === 'system') {
        scheme = parsed.scheme;
      }
    }
  } catch {
    /* ignore */
  }
  return { seed, scheme };
}

function persist(): void {
  try {
    localStorage.setItem('photomap.theme', JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

export function getPrefs(): ThemePrefs {
  return prefs;
}

export function setSeed(seed: string): void {
  prefs.seed = seed;
  persist();
  applyTheme();
}

export function setScheme(scheme: SchemeName): void {
  prefs.scheme = scheme;
  persist();
  applyTheme();
}

function effectiveScheme(): 'light' | 'dark' {
  if (prefs.scheme === 'system') {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return prefs.scheme;
}

export function applyTheme(): void {
  const scheme = effectiveScheme();
  const root = document.documentElement;
  root.dataset.scheme = scheme;

  let argb: number;
  try {
    argb = argbFromHex(prefs.seed);
  } catch {
    argb = argbFromHex('#1a73e8');
  }

  const theme = themeFromSourceColor(argb);
  const s = scheme === 'dark' ? theme.schemes.dark : theme.schemes.light;
  const neutral = NEUTRAL[scheme];

  for (const [key, cssVar] of VAR_MAP) {
    const flat = neutral[key];
    if (flat) {
      root.style.setProperty(cssVar, flat);
      continue;
    }
    const value = (s as unknown as Record<string, number>)[key];
    if (typeof value === 'number') {
      root.style.setProperty(cssVar, hexFromArgb(value));
    }
  }
}

/** Start listening to OS theme changes for the "system" scheme. */
export function initTheme(): void {
  applyTheme();
  media = window.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
  media?.addEventListener('change', () => {
    if (prefs.scheme === 'system') applyTheme();
  });
}
