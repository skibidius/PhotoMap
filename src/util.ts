// Small frontend helpers.

/** URL for a photo, served by the native `photo` protocol (or passed through
 * for data:/http URLs, used by the demo). */
export function photoSrc(path: string): string {
  // data:/http(s): are used by the demo and the web build (object URLs).
  if (/^(data:|blob:|https?:\/\/)/i.test(path)) return path;
  const base = /Windows/i.test(navigator.userAgent)
    ? 'http://photo.localhost/'
    : 'photo://localhost/';
  return `${base}?p=${encodeURIComponent(path)}`;
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
