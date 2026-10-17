import { invoke } from '@tauri-apps/api/core';

const cache = new Map<string, string>();

export function mimeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'heic':
    case 'heif':
      return 'image/heic';
    default:
      return 'image/jpeg';
  }
}

function toBlobUrl(bytes: number[], mime: string): string {
  const u8 = new Uint8Array(bytes);
  return URL.createObjectURL(new Blob([u8], { type: mime }));
}

/** Read a file through the backend and return a blob URL, cached per path. */
export async function loadImageUrl(path: string): Promise<string> {
  // Demo mode (?demo) supplies data: URLs directly.
  if (/^(data:|https?:)/i.test(path)) return path;
  const hit = cache.get(path);
  if (hit) return hit;
  const bytes = await invoke<number[]>('read_file_bytes', { path });
  const url = toBlobUrl(bytes, mimeFor(path));
  cache.set(path, url);
  return url;
}

/** Like loadImageUrl but never cached; the caller owns (and must revoke) the URL. */
export async function loadImageUrlOnce(path: string): Promise<string> {
  if (/^(data:|https?:)/i.test(path)) return path;
  const bytes = await invoke<number[]>('read_file_bytes', { path });
  return toBlobUrl(bytes, mimeFor(path));
}

/** Downscaled preview for the full-screen viewer (keeps the IPC payload small). */
export async function loadPreviewUrl(
  path: string,
  orientation = 1,
  maxPx = 1600,
): Promise<string> {
  const bytes = await invoke<number[]>('preview_bytes', { path, maxPx, orientation });
  return toBlobUrl(bytes, 'image/jpeg');
}

export function clearImageCache(): void {
  for (const url of cache.values()) URL.revokeObjectURL(url);
  cache.clear();
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatCoord(v: number): string {
  return v.toFixed(6);
}

export function toBase64(u8: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    s += String.fromCharCode(...u8.subarray(i, i + CHUNK));
  }
  return btoa(s);
}
