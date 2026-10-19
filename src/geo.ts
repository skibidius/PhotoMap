// Platform-independent KML / GeoJSON builders shared by the desktop and web
// builds. They only depend on the Photo shape.

import type { Photo } from './types';

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildKml(photos: Photo[]): string {
  const placemarks = photos
    .map((p) => {
      const heading = p.azimuth != null ? `<heading>${p.azimuth.toFixed(1)}</heading>` : '';
      const alt = p.altitude != null ? p.altitude : 0;
      const desc = [
        p.name,
        p.datetime ?? '',
        `${p.latitude.toFixed(6)}, ${p.longitude.toFixed(6)}`,
        p.azimuth != null ? `dir: ${p.azimuth.toFixed(0)}°` : '',
      ]
        .filter(Boolean)
        .join('\n');
      return `    <Placemark>
      <name>${xmlEscape(p.name)}</name>
      <description>${xmlEscape(desc)}</description>
      <LookAt>
        <longitude>${p.longitude.toFixed(6)}</longitude>
        <latitude>${p.latitude.toFixed(6)}</latitude>
        <altitude>${alt}</altitude>
        ${heading}
        <tilt>0</tilt>
        <range>120</range>
      </LookAt>
      <Point>
        <altitudeMode>absolute</altitudeMode>
        <coordinates>${p.longitude.toFixed(6)},${p.latitude.toFixed(6)},${alt}</coordinates>
      </Point>
    </Placemark>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
  <Document>
    <name>PhotoMap</name>
${placemarks}
  </Document>
</kml>
`;
}

export function buildGeoJson(photos: Photo[]): string {
  const features = photos.map((p) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [p.longitude, p.latitude] },
    properties: {
      name: p.name,
      album: p.album,
      datetime: p.datetime ?? null,
      azimuth: p.azimuth,
      altitude: p.altitude,
    },
  }));
  return JSON.stringify({ type: 'FeatureCollection', features }, null, 2);
}
