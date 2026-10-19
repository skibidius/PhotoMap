// Desktop export helpers: KML, GeoJSON and a composite PNG "map snapshot".
// The builders and the canvas renderer are shared with the web build
// (src/geo.ts and src/snapshot.ts); only saving/clipboard are native here.

import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';

import type { Photo } from './types';
import { buildKml, buildGeoJson } from './geo';
import { renderSnapshot } from './snapshot';
import { toBase64 } from './util';

export async function exportKml(photos: Photo[]): Promise<boolean> {
  const kml = buildKml(photos);
  const path = await save({
    defaultPath: 'photomap.kml',
    filters: [{ name: 'KML', extensions: ['kml'] }],
  });
  if (!path) return false;
  await invoke('save_text', { path, text: kml });
  return true;
}

export async function exportGeoJson(photos: Photo[]): Promise<boolean> {
  const geojson = buildGeoJson(photos);
  const path = await save({
    defaultPath: 'photomap.geojson',
    filters: [{ name: 'GeoJSON', extensions: ['geojson', 'json'] }],
  });
  if (!path) return false;
  await invoke('save_text', { path, text: geojson });
  return true;
}

/** Download a tile natively, bypassing browser CORS restrictions. */
async function fetchTile(url: string): Promise<Uint8Array> {
  const bytes = await invoke<number[]>('fetch_tile', { url });
  return new Uint8Array(bytes);
}

/** Render the current map view to PNG and save it to a file. */
export async function exportScreenshot(
  photos: Photo[],
  albumColors: Map<string, string>,
  showLabels: boolean,
): Promise<boolean> {
  const { blob } = await renderSnapshot(photos, albumColors, showLabels, fetchTile);
  const path = await save({
    defaultPath: 'photomap.png',
    filters: [{ name: 'PNG', extensions: ['png'] }],
  });
  if (!path) return false;
  const u8 = new Uint8Array(await blob.arrayBuffer());
  await invoke('save_bytes', { path, dataB64: toBase64(u8) });
  return true;
}

/** Render the current map view to PNG and copy it to the clipboard. */
export async function copyScreenshot(
  photos: Photo[],
  albumColors: Map<string, string>,
  showLabels: boolean,
): Promise<boolean> {
  const { blob } = await renderSnapshot(photos, albumColors, showLabels, fetchTile);
  try {
    const { writeImage } = await import('@tauri-apps/plugin-clipboard-manager');
    const { Image } = await import('@tauri-apps/api/image');
    const image = await Image.fromBytes(new Uint8Array(await blob.arrayBuffer()));
    await writeImage(image);
    return true;
  } catch {
    /* fall back to the web clipboard below */
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  return true;
}
