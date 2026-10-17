#!/usr/bin/env python3
"""Generate src/demo.ts with a handful of mock photos + embedded placeholder
thumbnails, used only to take README screenshots (?demo). No real photos are
involved — the thumbnails are synthetic gradients."""

import base64
import struct
import zlib


def make_png(w, h, top, bottom):
    def mix(a, b, t):
        return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

    rows = []
    for y in range(h):
        t = y / (h - 1)
        base = mix(top, bottom, t)
        row = bytearray()
        for x in range(w):
            dx = x - w * 0.60
            dy = y - h * 0.26
            if dx * dx + dy * dy < (h * 0.17) ** 2:
                c = (255, 246, 214)
            else:
                c = base
            row += bytes((c[0], c[1], c[2], 255))
        rows.append(bytes(row))
    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        c += struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        return c

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


THUMBS = [
    ((38, 166, 154), (21, 101, 192)),   # teal -> blue
    ((126, 87, 194), (233, 30, 99)),    # purple -> pink
    ((255, 167, 38), (230, 81, 0)),     # amber -> orange
]

PHOTOS = [
    ("IMG_0342.jpg", 55.755826, 37.617300, 45.0, 24.0, 73.7, "2026-08-12 14:30:00"),
    ("IMG_0347.jpg", 55.752000, 37.622500, 130.0, 50.0, 39.6, "2026-08-12 14:45:00"),
    ("IMG_0351.jpg", 55.760500, 37.609500, 240.0, 16.0, 96.7, "2026-08-12 15:02:00"),
]

ALBUMS = ["Moscow", "Moscow", "Park"]

entries = []
for i, ((t, b), (name, lat, lon, az, f35, fov, dt)) in enumerate(zip(THUMBS, PHOTOS)):
    png = make_png(256, 192, t, b)
    b64 = base64.b64encode(png).decode("ascii")
    entries.append(
        "  {\n"
        f"    id: 'demo{i}',\n"
        f"    path: 'demo/{name}',\n"
        f"    album: '{ALBUMS[i]}',\n"
        f"    name: '{name}',\n"
        f"    latitude: {lat},\n"
        f"    longitude: {lon},\n"
        f"    azimuth: {az},\n"
        "    azimuth_ref: 'T',\n"
        "    altitude: 156,\n"
        f"    datetime: '{dt}',\n"
        "    orientation: 1,\n"
        f"    thumb: 'data:image/png;base64,{b64}',\n"
        "    focal_length: null,\n"
        f"    focal_length_35: {f35},\n"
        f"    fov: {fov},\n"
        "  },"
    )

ts = """// Demo dataset used ONLY to take README screenshots via `?demo`.
// Contains synthetic placeholder images, not real user photos.

import type { Photo } from './types';

export const DEMO_PHOTOS: Photo[] = [
""" + "\n".join(entries) + """
];
"""

with open("src/demo.ts", "w") as f:
    f.write(ts)
print("wrote src/demo.ts")
