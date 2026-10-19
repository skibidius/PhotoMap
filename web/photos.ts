// Browser-only photo import: read EXIF with exifr, keep the files in memory as
// object URLs and return the same Photo shape the desktop backend produces.
// Nothing is uploaded — parsing happens locally in the tab.

import exifr from 'exifr';
import type { Photo } from '../src/types';

export interface ImportItem {
  file: File;
  album: string;
}

export interface ScanResult {
  photos: Photo[];
  scanned: number;
  withGps: number;
  errors: number;
}

const IMAGE_RE = /\.(jpe?g|png|webp|heic|heif|tiff?|avif)$/i;

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_RE.test(file.name);
}

/** Turn a plain File list (from an <input>) into album-tagged items. */
export function itemsFromFiles(files: File[]): ImportItem[] {
  return files.map((file) => {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
    const root = rel.split('/')[0];
    // For a hand-picked file the relative path is empty; for a folder pick the
    // first path segment is the folder the user chose.
    return { file, album: root && root !== file.name ? root : 'Imported' };
  });
}

function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve) => {
    const all: FileSystemEntry[] = [];
    const read = (): void => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(all);
            return;
          }
          all.push(...batch);
          read();
        },
        () => resolve(all),
      );
    };
    read();
  });
}

async function walkEntry(entry: FileSystemEntry, album: string): Promise<ImportItem[]> {
  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) => {
      (entry as FileSystemFileEntry).file(
        (f) => resolve(f),
        () => resolve(null),
      );
    });
    return file && isImageFile(file) ? [{ file, album }] : [];
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children = await readAllEntries(reader);
    const out: ImportItem[] = [];
    for (const child of children) {
      out.push(...(await walkEntry(child, album)));
    }
    return out;
  }
  return [];
}

/** Collect files (recursively for folders) from a browser drop. */
export async function collectDropItems(dt: DataTransfer): Promise<ImportItem[]> {
  const entries = [...dt.items]
    .map((item) => item.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => Boolean(e));

  if (entries.length === 0) {
    return [...dt.files].filter(isImageFile).map((file) => ({ file, album: 'Imported' }));
  }

  const out: ImportItem[] = [];
  for (const entry of entries) {
    const album = entry.isDirectory ? entry.name : 'Imported';
    out.push(...(await walkEntry(entry, album)));
  }
  return out;
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const direct = (o as { toNumber?: () => number }).toNumber;
    if (typeof direct === 'function') {
      const n = direct.call(o);
      if (Number.isFinite(n)) return n;
    }
    const numerator = o.numerator ?? o.num ?? o.n;
    const denominator = o.denominator ?? o.den ?? o.d;
    if (typeof numerator === 'number' && typeof denominator === 'number' && denominator !== 0) {
      return numerator / denominator;
    }
    if (Array.isArray(v) && v.length > 0) return toNumber(v[0]);
    if ('value' in o) return toNumber(o.value);
  }
  return null;
}

function orientationNumber(v: unknown): number {
  if (typeof v === 'number' && v >= 1 && v <= 8) return v;
  if (typeof v === 'string') {
    const named: Record<string, number> = {
      'Horizontal (normal)': 1,
      'Mirror horizontal': 2,
      'Rotate 180': 3,
      'Mirror vertical': 4,
      'Mirror horizontal and rotate 270 CW': 5,
      'Rotate 90 CW': 6,
      'Mirror horizontal and rotate 90 CW': 7,
      'Rotate 270 CW': 8,
    };
    if (named[v]) return named[v];
    const n = Number.parseInt(v, 10);
    if (n >= 1 && n <= 8) return n;
  }
  return 1;
}

function formatDate(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes(),
  )}:${p(d.getSeconds())}`;
}

/** Horizontal FOV, same rule as the Rust backend (full-frame 36 mm sensor). */
function fovFromFocal(focal35: number | null, focal: number | null): number {
  let f: number | null = null;
  if (focal35 != null && focal35 > 0) f = focal35;
  else if (focal != null && focal >= 8) f = focal;
  if (f == null) return 55;
  const fov = (2 * Math.atan(18 / f) * 180) / Math.PI;
  return Math.min(120, Math.max(10, fov));
}

interface ExifLike {
  latitude?: unknown;
  longitude?: unknown;
  GPSImgDirection?: unknown;
  GPSImgDirectionRef?: unknown;
  FocalLengthIn35mmFilm?: unknown;
  FocalLength?: unknown;
  DateTimeOriginal?: unknown;
  CreateDate?: unknown;
  ModifyDate?: unknown;
  Orientation?: unknown;
  GPSAltitude?: unknown;
  altitude?: unknown;
}

/** Parse EXIF for every item, skipping images without GPS coordinates. */
export async function scanImportItems(
  items: ImportItem[],
  onProgress?: (scanned: number, found: number, total: number) => void,
): Promise<ScanResult> {
  const photos: Photo[] = [];
  let scanned = 0;
  let withGps = 0;
  let errors = 0;

  for (const item of items) {
    scanned++;
    try {
      const data = (await exifr.parse(item.file, {
        gps: true,
        tiff: true,
        exif: true,
      })) as ExifLike | undefined;

      if (!data) {
        errors++;
      } else {
        const latitude = toNumber(data.latitude);
        const longitude = toNumber(data.longitude);
        if (latitude == null || longitude == null) {
          // Not a geotagged photo — silently skip it.
        } else {
          withGps++;
          const focal35 = toNumber(data.FocalLengthIn35mmFilm);
          const focal = toNumber(data.FocalLength);
          const direction = toNumber(data.GPSImgDirection);
          const directionRef =
            typeof data.GPSImgDirectionRef === 'string' ? data.GPSImgDirectionRef : null;
          const url = URL.createObjectURL(item.file);
          photos.push({
            id: `${item.file.name}|${item.file.size}|${item.file.lastModified}`,
            path: url,
            album: item.album,
            name: item.file.name,
            latitude,
            longitude,
            azimuth: direction,
            azimuth_ref: directionRef,
            altitude: toNumber(data.GPSAltitude ?? data.altitude),
            datetime: formatDate(data.DateTimeOriginal ?? data.CreateDate ?? data.ModifyDate),
            orientation: orientationNumber(data.Orientation),
            thumb: url,
            focal_length: focal,
            focal_length_35: focal35,
            fov: fovFromFocal(focal35, focal),
          });
        }
      }
    } catch {
      errors++;
    }
    onProgress?.(scanned, withGps, items.length);
  }

  return { photos, scanned, withGps, errors };
}
