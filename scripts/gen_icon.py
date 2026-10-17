#!/usr/bin/env python3
"""Generate the PhotoMap app icon (1024x1024 PNG) with no external deps.

A map pin filled with a small landscape (sky, sun, two mountain ridges) and
framed by a white border, on a Google-blue → indigo gradient tile. The mark
reads as "photo on a map" and keeps a clear silhouette at small sizes.
Rendered with 3x3 supersampling for smooth edges.
"""
import math
import os
import struct
import zlib

SIZE = 1024
SS = 3

# Palette
BG_TOP = (66, 133, 244)          # #4285F4
BG_BOTTOM = (124, 77, 255)       # #7C4DFF
WHITE = (255, 255, 255)
SKY_TOP = (176, 208, 255)        # #B0D0FF
SKY_HORIZON = (240, 247, 255)    # #F0F7FF
SUN = (255, 193, 7)              # #FFC107
MTN_BACK = (138, 180, 248)       # #8AB4F8
MTN_FRONT = (11, 87, 208)        # #0B57D0

# Pin geometry
CX = 512.0
PIN_CY = 425.0
R_IN = 250.0
TIP_IN = 820.0
R_OUT = 266.0
TIP_OUT = 836.0

# Lens inside the pin head
LENS_C = (512.0, 425.0)
LENS_BARREL_R = 142.0
LENS_GLASS_R = 98.0
LENS_RING = 8.0
GLASS = (59, 130, 246)     # #3B82F6
BARREL = (11, 87, 208)     # #0B57D0


def mix(a, b, t):
    return (
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    )


def clamp(v, lo=0.0, hi=1.0):
    return max(lo, min(hi, v))


def sd_round_rect(px, py, cx, cy, hw, hh, r):
    qx = abs(px - cx) - (hw - r)
    qy = abs(py - cy) - (hh - r)
    ox = max(qx, 0.0)
    oy = max(qy, 0.0)
    return math.hypot(ox, oy) + min(max(qx, qy), 0.0) - r


def sd_circle(px, py, cx, cy, r):
    return math.hypot(px - cx, py - cy) - r


def point_in_triangle(px, py, a, b, c):
    def sign(p1, p2, p3):
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])

    d1 = sign((px, py), a, b)
    d2 = sign((px, py), b, c)
    d3 = sign((px, py), c, a)
    neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
    pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
    return not (neg and pos)


def coverage(d):
    return clamp(0.5 - d)


def interp(x, pts):
    if x <= pts[0][0]:
        return pts[0][1]
    if x >= pts[-1][0]:
        return pts[-1][1]
    for i in range(len(pts) - 1):
        x0, y0 = pts[i]
        x1, y1 = pts[i + 1]
        if x0 <= x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return pts[-1][1]


def make_pin(r, tip_y):
    d = tip_y - PIN_CY
    c = r / d
    s = math.sqrt(1.0 - c * c)
    return (r, (CX - r * s, PIN_CY + r * c), (CX + r * s, PIN_CY + r * c), (CX, tip_y))


PIN_IN = make_pin(R_IN, TIP_IN)
PIN_OUT = make_pin(R_OUT, TIP_OUT)


def pin_cov(px, py, pin):
    r, a, b, tip = pin
    cov = coverage(sd_circle(px, py, CX, PIN_CY, r))
    if point_in_triangle(px, py, a, b, tip):
        cov = 1.0
    return cov


def lens(px, py):
    d = math.hypot(px - LENS_C[0], py - LENS_C[1])
    if d <= LENS_GLASS_R:
        color = GLASS
        h1 = math.hypot(px - (LENS_C[0] - 38.0), py - (LENS_C[1] - 38.0))
        h2 = math.hypot(px - (LENS_C[0] - 24.0), py - (LENS_C[1] - 24.0))
        if h1 <= 34.0 and h2 >= 34.0:
            color = WHITE
        return color
    if d <= LENS_GLASS_R + LENS_RING:
        return WHITE
    if d <= LENS_BARREL_R:
        return BARREL
    return WHITE


def sample(px, py):
    rr = sd_round_rect(px, py, CX, SIZE / 2.0, SIZE / 2.0 - 28, SIZE / 2.0 - 28, 200)
    if rr >= 0.5:
        return (0.0, 0.0, 0.0, 0.0)
    bg_alpha = coverage(rr)

    t = (px + py) / (2 * (SIZE - 1))
    bg = mix(BG_TOP, BG_BOTTOM, t)

    glow = clamp(1.0 - math.hypot(px - 512.0, py - 320.0) / 560.0)
    bg = mix(bg, WHITE, 0.10 * glow)

    ds = math.hypot(px - 512.0, py - 520.0)
    shadow = clamp(1.0 - (ds - 230.0) / 200.0)
    bg = mix(bg, (44, 33, 82), 0.12 * shadow)

    cov_out = pin_cov(px, py, PIN_OUT)
    if cov_out > 0.0:
        cov_in = pin_cov(px, py, PIN_IN)
        pin_col = WHITE
        if cov_in > 0.0:
            pin_col = mix(WHITE, lens(px, py), cov_in)
        return (
            bg[0] + (pin_col[0] - bg[0]) * cov_out,
            bg[1] + (pin_col[1] - bg[1]) * cov_out,
            bg[2] + (pin_col[2] - bg[2]) * cov_out,
            bg_alpha,
        )

    return (bg[0], bg[1], bg[2], bg_alpha)


def main():
    rows = []
    for y in range(SIZE):
        row = bytearray()
        for x in range(SIZE):
            ar = ag = ab = aa = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    r, g, b, a = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)
                    ar += r
                    ag += g
                    ab += b
                    aa += a
            n = SS * SS
            row += bytes(
                (
                    int(round(ar / n)),
                    int(round(ag / n)),
                    int(round(ab / n)),
                    int(round(aa / n * 255)),
                )
            )
        rows.append(bytes(row))

    raw = b"".join(b"\x00" + row for row in rows)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        c += struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        return c

    ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", ihdr)
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")

    os.makedirs("assets", exist_ok=True)
    with open("assets/app-icon.png", "wb") as f:
        f.write(png)
    print("wrote assets/app-icon.png")


if __name__ == "__main__":
    main()
