// Browser export helpers. KML/GeoJSON come from the shared builders; the PNG
// snapshot uses the shared canvas renderer and downloads tiles with `fetch`.
// Basemaps that do not send CORS headers (Google, Yandex) cannot be captured,
// so the caller gets a "tiles-blocked" error and can suggest OpenStreetMap.

import type { Photo } from '../src/types';
import { buildKml, buildGeoJson } from '../src/geo';
import { renderSnapshot } from '../src/snapshot';

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function downloadText(text: string, name: string, mime: string): void {
  downloadBlob(new Blob([text], { type: mime }), name);
}

export async function exportKml(photos: Photo[]): Promise<boolean> {
  downloadText(buildKml(photos), 'photomap.kml', 'application/vnd.google-earth.kml+xml');
  return true;
}

export async function exportGeoJson(photos: Photo[]): Promise<boolean> {
  downloadText(buildGeoJson(photos), 'photomap.geojson', 'application/geo+json');
  return true;
}

async function fetchTile(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error(`tile ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function exportScreenshot(
  photos: Photo[],
  albumColors: Map<string, string>,
  showLabels: boolean,
): Promise<boolean> {
  const { blob, tiles, failedTiles } = await renderSnapshot(
    photos,
    albumColors,
    showLabels,
    fetchTile,
  );
  if (tiles === 0 && failedTiles > 0) throw new Error('tiles-blocked');
  downloadBlob(blob, 'photomap.png');
  return true;
}

export async function copyScreenshot(
  photos: Photo[],
  albumColors: Map<string, string>,
  showLabels: boolean,
): Promise<boolean> {
  const { blob, tiles, failedTiles } = await renderSnapshot(
    photos,
    albumColors,
    showLabels,
    fetchTile,
  );
  if (tiles === 0 && failedTiles > 0) throw new Error('tiles-blocked');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  return true;
}
