// Browser-only photo import: read EXIF with exifr, keep the files in memory as
// object URLs and return the same Photo shape the desktop backend produces.
// Nothing is uploaded — parsing happens locally in the tab.
//
// Performance notes:
// - EXIF parsing and thumbnail generation run in a small parallel pool.
// - The sidebar gets a real downscaled thumbnail instead of the full JPEG, so
//   scrolling a big album never decodes 12-megapixel images in 48px boxes.
// - Files that are already in the list are skipped before any work is done.

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
  skipped: number;
}

const IMAGE_RE = /\.(jpe?g|png|webp|heic|heif|tiff?|avif)$/i;
const THUMB_MAX = 400;
const THUMB_QUALITY = 0.8;
const WORKERS = Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1));

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_RE.test(file.name);
}

/** Stable id: re-importing the same file updates instead of duplicating it. */
export function photoId(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
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

/**
 * Downscale a file to a small JPEG for the sidebar and the map popup.
 * Uses OffscreenCanvas where available; the <img> in the lightbox still gets
 * the full-resolution object URL.
 */
async function makeThumbnail(
  file: File,
  sourceWidth?: number | null,
  sourceHeight?: number | null,
): Promise<Blob | null> {
  let bmp: ImageBitmap | null = null;
  try {
    // When the dimensions are known (EXIF usually has them), ask the decoder
    // for a small bitmap directly. A 14400x7200 panorama then never becomes a
    // ~400 MB RGBA image just to produce a 400x200 list thumbnail.
    if (sourceWidth && sourceHeight && sourceWidth > 0 && sourceHeight > 0) {
      const scale = Math.min(1, THUMB_MAX / Math.max(sourceWidth, sourceHeight));
      const tw = Math.max(1, Math.round(sourceWidth * scale));
      const th = Math.max(1, Math.round(sourceHeight * scale));
      try {
        bmp = await createImageBitmap(file, {
          resizeWidth: tw,
          resizeHeight: th,
          resizeQuality: 'medium',
          imageOrientation: 'from-image',
        });
      } catch {
        bmp = null;
      }
    }
    if (!bmp) {
      bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    }
  } catch {
    return null;
  }
  try {
    const scale = Math.min(1, THUMB_MAX / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));

    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bmp, 0, 0, w, h);
      return await canvas.convertToBlob({ type: 'image/jpeg', quality: THUMB_QUALITY });
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, w, h);
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', THUMB_QUALITY),
    );
  } catch {
    return null;
  } finally {
    bmp.close();
  }
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
  ProjectionType?: unknown;
  UsePanoramaViewer?: unknown;
  FullPanoWidthPixels?: unknown;
  FullPanoHeightPixels?: unknown;
  PoseHeadingDegrees?: unknown;
  InitialViewHeadingDegrees?: unknown;
  GimbalYawDegree?: unknown;
  ExifImageWidth?: unknown;
  ExifImageHeight?: unknown;
  ImageWidth?: unknown;
  ImageHeight?: unknown;
}

async function photoFromItem(item: ImportItem, id: string): Promise<Photo | null> {
  const data = (await exifr.parse(item.file, {
    gps: true,
    tiff: true,
    exif: true,
    xmp: true,
  })) as ExifLike | undefined;
  if (!data) return null;

  const latitude = toNumber(data.latitude);
  const longitude = toNumber(data.longitude);
  if (latitude == null || longitude == null) return null;

  const orientation = orientationNumber(data.Orientation);
  const imageWidth = toNumber(data.ExifImageWidth) ?? toNumber(data.ImageWidth);
  const imageHeight = toNumber(data.ExifImageHeight) ?? toNumber(data.ImageHeight);

  const projection =
    typeof data.ProjectionType === 'string' ? data.ProjectionType.toLowerCase() : '';
  const useViewer =
    data.UsePanoramaViewer === true || String(data.UsePanoramaViewer).toLowerCase() === 'true';
  const fullW = toNumber(data.FullPanoWidthPixels);
  const fullH = toNumber(data.FullPanoHeightPixels);
  const ratio =
    fullW && fullH && fullH > 0
      ? fullW / fullH
      : imageWidth && imageHeight && imageHeight > 0
        ? imageWidth / imageHeight
        : 0;
  const isPano =
    projection === 'equirectangular' ||
    useViewer ||
    (ratio > 1.9 && ratio < 2.1 && (fullW ?? imageWidth ?? 0) >= 4096);

  // DJI panoramas carry the gimbal yaw instead of GPSImgDirection; use it as
  // the marker/popup heading when the EXIF direction is missing.
  const heading = toNumber(
    data.PoseHeadingDegrees ?? data.InitialViewHeadingDegrees ?? data.GimbalYawDegree,
  );
  const gpsDirection = toNumber(data.GPSImgDirection);
  const direction =
    gpsDirection ?? (isPano && heading != null ? ((heading % 360) + 360) % 360 : null);
  let directionRef: string | null = null;
  if (gpsDirection != null) {
    directionRef =
      typeof data.GPSImgDirectionRef === 'string' ? data.GPSImgDirectionRef : null;
  } else if (direction != null) {
    directionRef = 'T';
  }

  // EXIF dimensions describe the stored pixels; swap them for orientations
  // that rotate the image so the thumbnail keeps the right aspect ratio.
  const swap = orientation >= 5 && orientation <= 8;
  const thumbW = swap ? imageHeight : imageWidth;
  const thumbH = swap ? imageWidth : imageHeight;

  const fullUrl = URL.createObjectURL(item.file);
  const thumbBlob = await makeThumbnail(item.file, thumbW, thumbH);
  const thumb = thumbBlob ? URL.createObjectURL(thumbBlob) : fullUrl;

  const focal35 = toNumber(data.FocalLengthIn35mmFilm);
  const focal = toNumber(data.FocalLength);

  return {
    id,
    path: fullUrl,
    album: item.album,
    name: item.file.name,
    latitude,
    longitude,
    azimuth: direction,
    azimuth_ref: directionRef,
    altitude: toNumber(data.GPSAltitude ?? data.altitude),
    datetime: formatDate(data.DateTimeOriginal ?? data.CreateDate ?? data.ModifyDate),
    orientation,
    thumb,
    focal_length: focal,
    focal_length_35: focal35,
    fov: fovFromFocal(focal35, focal),
    is_pano: isPano,
  };
}

/**
 * Parse EXIF and build thumbnails for every item. `skipIds` lets a repeated
 * import of the same folder finish instantly.
 */
export async function scanImportItems(
  items: ImportItem[],
  skipIds?: Set<string>,
  onProgress?: (scanned: number, found: number, total: number) => void,
): Promise<ScanResult> {
  const results: Array<Photo | null> = new Array(items.length).fill(null);
  const seen = new Set(skipIds ?? []);
  let scanned = 0;
  let found = 0;
  let errors = 0;
  let skipped = 0;
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      const item = items[index];
      const id = photoId(item.file);

      if (seen.has(id)) {
        skipped++;
      } else {
        seen.add(id);
        try {
          const photo = await photoFromItem(item, id);
          if (photo) {
            results[index] = photo;
            found++;
          }
        } catch {
          errors++;
        }
      }

      scanned++;
      onProgress?.(scanned, found, items.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(WORKERS, items.length) }, () => worker()),
  );

  return {
    photos: results.filter((p): p is Photo => p !== null),
    scanned,
    withGps: found,
    errors,
    skipped,
  };
}
