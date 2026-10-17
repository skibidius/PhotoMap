#!/usr/bin/env python3
"""Generate README screenshots with Pillow.

The map screenshot composites real OpenStreetMap tiles with the app's marker
style (colored dots + direction cones) and a legend, inside a faithful layout
(top bar + sidebar + map). No GUI or browser required.
"""

import io
import math
import os
import urllib.request

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "..", "docs", "screenshots")

# Material You palette (seed #6750a4, light scheme)
PRIMARY = (103, 80, 164)
ON_PRIMARY = (255, 255, 255)
PRIMARY_CONTAINER = (234, 221, 255)
SURFACE = (254, 247, 255)
SURFACE_LOW = (247, 242, 250)
SURFACE_HIGH = (236, 230, 240)
SURFACE_HIGHEST = (230, 224, 233)
ON_SURFACE = (29, 27, 32)
ON_SURFACE_VARIANT = (73, 69, 79)
OUTLINE_VARIANT = (202, 196, 208)
SECONDARY_CONTAINER = (232, 222, 248)

# Demo data (mirrors src/demo.ts)
PHOTOS = [
    ("IMG_0342.jpg", 55.755826, 37.617300, 45.0, "Moscow", (38, 166, 154), (21, 101, 192)),
    ("IMG_0347.jpg", 55.752000, 37.622500, 130.0, "Moscow", (126, 87, 194), (233, 30, 99)),
    ("IMG_0351.jpg", 55.760500, 37.609500, 240.0, "Park", (255, 167, 38), (230, 81, 0)),
]
ALBUM_COLORS = {"Moscow": (103, 80, 164), "Park": (11, 87, 208)}
ALBUM_ORDER = ["Moscow", "Park"]


def load_font(size, bold=False):
    candidates = []
    if bold:
        candidates += [
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
        ]
    candidates += [
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for p in candidates:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def project(lat, lng, zoom):
    world = 256 * (2 ** zoom)
    x = (lng + 180) / 360 * world
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * world
    return x, y


def fetch_tile(z, x, y):
    url = f"https://tile.openstreetmap.org/{z}/{x}/{y}.png"
    req = urllib.request.Request(url, headers={"User-Agent": "PhotoMap/0.1 (screenshot generator)"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def gradient(size, top, bottom):
    w, h = size
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / (h - 1)
        c = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        d.line([(0, y), (w, y)], fill=c)
    return img


def draw_map_screenshot():
    W, H = 1280, 800
    TOPBAR = 64
    SIDEBAR = 340
    MAP_X = SIDEBAR
    MAP_W = W - SIDEBAR
    MAP_H = H - TOPBAR

    img = Image.new("RGB", (W, H), SURFACE)
    d = ImageDraw.Draw(img, "RGBA")

    # --- top bar ---
    d.rectangle([0, 0, W, TOPBAR], fill=SURFACE)
    d.line([(0, TOPBAR - 1), (W, TOPBAR - 1)], fill=OUTLINE_VARIANT, width=1)

    # logo (camera-ish): rounded square + lens
    d.rounded_rectangle([16, 16, 48, 48], radius=10, fill=PRIMARY)
    d.ellipse([25, 25, 39, 39], fill=ON_PRIMARY)
    d.ellipse([30, 30, 34, 34], fill=PRIMARY)
    d.text((56, 18), "PhotoMap", font=load_font(20, True), fill=ON_SURFACE)

    # import pill
    d.rounded_rectangle([150, 14, 246, 50], radius=18, fill=PRIMARY)
    d.text((166, 20), "+", font=load_font(20, True), fill=ON_PRIMARY)
    d.text((182, 20), "Import", font=load_font(15, True), fill=ON_PRIMARY)

    # search pill
    sx0, sy0, sx1, sy1 = 262, 14, 520, 50
    d.rounded_rectangle([sx0, sy0, sx1, sy1], radius=18, fill=SURFACE_HIGH)
    d.ellipse([sx0 + 14, sy0 + 15, sx0 + 26, sy0 + 27], outline=ON_SURFACE_VARIANT, width=2)
    d.line([(sx0 + 24, sy0 + 26), (sx0 + 29, sy0 + 31)], fill=ON_SURFACE_VARIANT, width=2)
    d.text((sx0 + 36, sy0 + 16), "Search by name…", font=load_font(14), fill=ON_SURFACE_VARIANT)

    # basemap select (right)
    b0, b1 = W - 360, W - 230
    d.rounded_rectangle([b0, 12, b1, 52], radius=8, outline=(121, 116, 126), width=1, fill=(255, 255, 255))
    d.text((b0 + 12, 20), "Yandex — map", font=load_font(14), fill=ON_SURFACE)
    d.polygon([(b1 - 24, 28), (b1 - 12, 28), (b1 - 18, 36)], fill=ON_SURFACE_VARIANT)

    # three icon buttons
    for i in range(3):
        cx = b1 + 24 + i * 44
        d.ellipse([cx - 18, 14, cx + 18, 50], outline=ON_SURFACE_VARIANT, width=1, fill=(255, 255, 255))
    # export arrow
    c1 = b1 + 24
    d.rectangle([c1 - 3, 22, c1 + 3, 36], fill=ON_SURFACE_VARIANT)
    d.polygon([(c1 - 8, 34), (c1 + 8, 34), (c1, 44)], fill=ON_SURFACE_VARIANT)
    # theme (half moon)
    c2 = b1 + 68
    d.pieslice([c2 - 10, 22, c2 + 10, 42], 90, 270, fill=ON_SURFACE_VARIANT)
    # settings (gear)
    c3 = b1 + 112
    d.ellipse([c3 - 5, 26, c3 + 5, 38], outline=ON_SURFACE_VARIANT, width=2)
    d.ellipse([c3 - 2, 29, c3 + 2, 35], fill=ON_SURFACE_VARIANT)

    # --- sidebar ---
    d.rectangle([0, TOPBAR, SIDEBAR, H], fill=SURFACE_LOW)
    d.line([(SIDEBAR - 1, TOPBAR), (SIDEBAR - 1, H)], fill=OUTLINE_VARIANT, width=1)

    # sidebar header: album + sort selects
    d.rounded_rectangle([12, TOPBAR + 12, 232, TOPBAR + 52], radius=8, outline=(121, 116, 126), width=1, fill=(255, 255, 255))
    d.text((24, TOPBAR + 20), "All albums", font=load_font(14), fill=ON_SURFACE)
    d.polygon([(210, TOPBAR + 28), (222, TOPBAR + 28), (216, TOPBAR + 36)], fill=ON_SURFACE_VARIANT)
    d.rounded_rectangle([240, TOPBAR + 12, 328, TOPBAR + 52], radius=8, outline=(121, 116, 126), width=1, fill=(255, 255, 255))
    d.text((252, TOPBAR + 20), "By date", font=load_font(14), fill=ON_SURFACE)
    d.polygon([(308, TOPBAR + 28), (318, TOPBAR + 28), (313, TOPBAR + 36)], fill=ON_SURFACE_VARIANT)
    d.text((16, TOPBAR + 66), "3 photos", font=load_font(12), fill=ON_SURFACE_VARIANT)

    # sidebar photo items
    y0 = TOPBAR + 88
    for i, (name, lat, lng, az, album, ttop, tbot) in enumerate(PHOTOS):
        yy = y0 + i * 68
        # selected background for first item
        if i == 0:
            d.rounded_rectangle([8, yy - 6, SIDEBAR - 8, yy + 56], radius=16, fill=SECONDARY_CONTAINER)
        thumb = gradient((48, 48), ttop, tbot)
        img.paste(thumb, (16, yy))
        d.text((76, yy + 2), name, font=load_font(14, True), fill=ON_SURFACE)
        sub = "2026-08-12 · " + album
        d.text((76, yy + 22), sub, font=load_font(12), fill=ON_SURFACE_VARIANT)
        d.text((76, yy + 38), f"{lat:.6f}, {lng:.6f} · {az:.0f}°", font=load_font(11), fill=ON_SURFACE_VARIANT)

    # --- map ---
    map_img = Image.new("RGB", (MAP_W, MAP_H), (216, 221, 227))
    md = ImageDraw.Draw(map_img, "RGBA")

    zoom = 15
    clat = sum(p[1] for p in PHOTOS) / len(PHOTOS)
    clng = sum(p[2] for p in PHOTOS) / len(PHOTOS)
    cx, cy = project(clat, clng, zoom)
    top_left = (cx - MAP_W / 2, cy - MAP_H / 2)

    n = 2 ** zoom
    tx0 = int(math.floor(top_left[0] / 256))
    tx1 = int(math.floor((top_left[0] + MAP_W) / 256))
    ty0 = int(math.floor(top_left[1] / 256))
    ty1 = int(math.floor((top_left[1] + MAP_H) / 256))

    for ty in range(ty0, ty1 + 1):
        if ty < 0 or ty >= n:
            continue
        for tx in range(tx0, tx1 + 1):
            xx = tx % n
            try:
                data = fetch_tile(zoom, xx, ty)
                tile = Image.open(io.BytesIO(data)).convert("RGB")
            except Exception:
                continue
            dx = xx * 256 - top_left[0]
            dy = ty * 256 - top_left[1]
            map_img.paste(tile, (int(dx), int(dy)))

    md = ImageDraw.Draw(map_img, "RGBA")

    def to_map(lat, lng):
        px, py = project(lat, lng, zoom)
        return px - top_left[0], py - top_left[1]

    # markers + direction cones
    for name, lat, lng, az, album, _, _ in PHOTOS:
        x, y = to_map(lat, lng)
        color = ALBUM_COLORS[album]
        rad = math.radians(az)
        dirx, diry = math.sin(rad), -math.cos(rad)
        L = 40
        # cone (translucent triangle)
        half = math.radians(16)
        px1, py1 = x + L * math.cos(half) * dirx - L * math.sin(half) * diry, y + L * math.cos(half) * diry + L * math.sin(half) * dirx
        px2, py2 = x + L * math.cos(half) * dirx + L * math.sin(half) * diry, y + L * math.cos(half) * diry - L * math.sin(half) * dirx
        cone = Image.new("RGBA", (MAP_W, MAP_H), (0, 0, 0, 0))
        ImageDraw.Draw(cone).polygon([(x, y), (px1, py1), (px2, py2)], fill=color + (72,))
        map_img = Image.alpha_composite(map_img.convert("RGBA"), cone)
        md = ImageDraw.Draw(map_img, "RGBA")
        # dot
        md.ellipse([x - 7, y - 7, x + 7, y + 7], fill=color, outline=(255, 255, 255), width=2)

    # legend (bottom-left of map)
    lg_x, lg_y = 16, MAP_H - 106
    md.rounded_rectangle([lg_x, lg_y, lg_x + 210, lg_y + 90], radius=14, fill=(243, 237, 247, 240), outline=OUTLINE_VARIANT, width=1)
    md.text((lg_x + 14, lg_y + 12), "Legend", font=load_font(13, True), fill=ON_SURFACE)
    for i, alb in enumerate(ALBUM_ORDER):
        cnt = sum(1 for p in PHOTOS if p[4] == alb)
        yy = lg_y + 38 + i * 22
        md.ellipse([lg_x + 18, yy, lg_x + 28, yy + 10], fill=ALBUM_COLORS[alb])
        md.text((lg_x + 38, yy - 1), f"{alb} ({cnt})", font=load_font(13), fill=ON_SURFACE)

    # scale bar (bottom-right of map)
    mpp = 156543.03392 * math.cos(math.radians(clat)) / (2 ** zoom)
    dist = 500
    bar = dist / mpp
    bx = MAP_W - bar - 24
    by = MAP_H - 30
    md.line([(bx, by), (bx + bar, by)], fill=ON_SURFACE, width=2)
    md.line([(bx, by - 5), (bx, by + 5)], fill=ON_SURFACE, width=2)
    md.line([(bx + bar, by - 5), (bx + bar, by + 5)], fill=ON_SURFACE, width=2)
    md.text((bx + bar / 2 - 14, by - 20), f"{dist} m", font=load_font(12), fill=ON_SURFACE)

    # attribution
    md.text((MAP_W - 220, MAP_H - 14), "© OpenStreetMap contributors", font=load_font(10), fill=(80, 80, 80))

    # header card (top-left of map)
    hx, hy = 16, 16
    md.rounded_rectangle([hx, hy, hx + 280, hy + 64], radius=14, fill=(243, 237, 247, 240), outline=OUTLINE_VARIANT, width=1)
    md.text((hx + 16, hy + 12), "PhotoMap — 3 photos", font=load_font(16, True), fill=ON_SURFACE)
    md.text((hx + 16, hy + 38), "2026-08-12", font=load_font(12), fill=ON_SURFACE_VARIANT)

    img.paste(map_img.convert("RGB"), (MAP_X, TOPBAR))

    out = os.path.join(OUT_DIR, "map.png")
    os.makedirs(OUT_DIR, exist_ok=True)
    img.save(out)
    print("wrote", out)


def draw_settings_screenshot():
    W, H = 900, 640
    img = Image.new("RGB", (W, H), (24, 20, 30))
    d = ImageDraw.Draw(img, "RGBA")

    # dimmed map behind (simple gradient to suggest the app)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=(int(60 + 10 * t), int(50 + 10 * t), int(70 + 10 * t)))

    # card
    cw, ch = 440, 480
    cx0, cy0 = (W - cw) // 2, (H - ch) // 2
    d.rounded_rectangle([cx0, cy0, cx0 + cw, cy0 + ch], radius=24, fill=(243, 237, 247))

    # header
    d.text((cx0 + 28, cy0 + 24), "Settings", font=load_font(20, True), fill=ON_SURFACE)
    d.ellipse([cx0 + cw - 60, cy0 + 24, cx0 + cw - 36, cy0 + 48], outline=ON_SURFACE_VARIANT, width=2)
    d.line([(cx0 + cw - 52, cy0 + 32), (cx0 + cw - 44, cy0 + 40)], fill=ON_SURFACE_VARIANT, width=2)
    d.line([(cx0 + cw - 44, cy0 + 32), (cx0 + cw - 52, cy0 + 40)], fill=ON_SURFACE_VARIANT, width=2)

    y = cy0 + 78
    d.text((cx0 + 28, y), "Theme", font=load_font(13), fill=ON_SURFACE_VARIANT)
    y += 26
    seg_y = y
    seg_h = 40
    d.rounded_rectangle([cx0 + 28, seg_y, cx0 + cw - 28, seg_y + seg_h], radius=20, fill=SURFACE_HIGH)
    seg_w = (cw - 56) // 3
    labels = ["System", "Light", "Dark"]
    for i, lab in enumerate(labels):
        x0 = cx0 + 28 + i * seg_w
        active = lab == "Light"
        if active:
            d.rounded_rectangle([x0 + 4, seg_y + 4, x0 + seg_w - 4, seg_y + seg_h - 4], radius=16, fill=SECONDARY_CONTAINER)
        tw = d.textlength(lab, font=load_font(14))
        d.text((x0 + (seg_w - tw) / 2, seg_y + 11), lab, font=load_font(14), fill=(29, 27, 43) if active else ON_SURFACE_VARIANT)

    y = seg_y + seg_h + 34
    d.text((cx0 + 28, y), "Accent color", font=load_font(13), fill=ON_SURFACE_VARIANT)
    y += 28
    accents = ["#6750a4", "#0b57d0", "#006c4c", "#b3261e", "#7d5260", "#006a6a", "#825500", "#f47735"]
    hex_to_rgb = lambda s: tuple(int(s[i:i + 2], 16) for i in (1, 3, 5))
    for i, a in enumerate(accents):
        x0 = cx0 + 28 + i * 46
        c = hex_to_rgb(a)
        d.ellipse([x0, y, x0 + 36, y + 36], fill=c)
        if i == 0:
            d.ellipse([x0 - 4, y - 4, x0 + 40, y + 40], outline=ON_SURFACE, width=2)
    y += 56
    d.text((cx0 + 28, y + 12), "Custom", font=load_font(14), fill=ON_SURFACE)
    d.ellipse([cx0 + 90, y, cx0 + 126, y + 36], fill=PRIMARY)
    d.ellipse([cx0 + 98, y + 8, cx0 + 118, y + 28], fill=ON_PRIMARY)

    y += 66
    d.text((cx0 + 28, y), "Language", font=load_font(13), fill=ON_SURFACE_VARIANT)
    y += 26
    d.rounded_rectangle([cx0 + 28, y, cx0 + cw - 28, y + seg_h], radius=20, fill=SURFACE_HIGH)
    langs = [("Русский", False), ("English", True)]
    for i, (lab, active) in enumerate(langs):
        x0 = cx0 + 28 + i * seg_w
        if active:
            d.rounded_rectangle([x0 + 4, y + 4, x0 + seg_w - 4, y + seg_h - 4], radius=16, fill=SECONDARY_CONTAINER)
        tw = d.textlength(lab, font=load_font(14))
        d.text((x0 + (seg_w - tw) / 2, y + 11), lab, font=load_font(14), fill=(29, 27, 43) if active else ON_SURFACE_VARIANT)

    out = os.path.join(OUT_DIR, "settings.png")
    os.makedirs(OUT_DIR, exist_ok=True)
    img.save(out)
    print("wrote", out)


if __name__ == "__main__":
    draw_map_screenshot()
    draw_settings_screenshot()
