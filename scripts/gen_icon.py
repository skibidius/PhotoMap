#!/usr/bin/env python3
"""Generate the PhotoMap app icon (1024x1024 PNG) with no external deps.

A simple "map pin + direction arrow" mark on a Material-ish gradient rounded
square. Rendered with 3x3 supersampling for smooth edges, then written as PNG
using only the standard library (zlib + struct).
"""
import math
import struct
import zlib

SIZE = 1024
SS = 3  # supersampling factor per axis

# Palette
TOP = (124, 77, 255)     # #7C4DFF
BOTTOM = (41, 121, 255)  # #2979FF
WHITE = (255, 255, 255)

# Geometry (in 1024 space)
CX = SIZE / 2.0
PIN_CY = 470.0
PIN_R = 268.0
HOLE_R = 150.0

# Pin tail triangle (pointing down)
TA = (CX - 176, 640)   # left base
TB = (CX + 176, 640)   # right base
TC = (CX, 910)         # tip

# Arrow triangle (pointing up), inside the hole
AA = (CX, 412)
AB = (CX - 84, 520)
AC = (CX + 84, 520)


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
    """Smooth coverage in [0, 1] from a signed distance."""
    return min(1.0, max(0.0, 0.5 - d))


def sample(px, py):
    rr = sd_round_rect(px, py, CX, SIZE / 2.0, SIZE / 2.0 - 28, SIZE / 2.0 - 28, 210)
    if rr >= 0.5:
        return (0, 0, 0, 0.0)

    t = py / SIZE
    base = (
        TOP[0] + (BOTTOM[0] - TOP[0]) * t,
        TOP[1] + (BOTTOM[1] - TOP[1]) * t,
        TOP[2] + (BOTTOM[2] - TOP[2]) * t,
    )
    bg_alpha = coverage(rr)

    # Pin = circle + tail triangle
    pin = coverage(sd_circle(px, py, CX, PIN_CY, PIN_R))
    if point_in_triangle(px, py, TA, TB, TC):
        pin = 1.0
    pin = min(1.0, pin)

    hole = coverage(sd_circle(px, py, CX, PIN_CY, HOLE_R))
    arrow = 1.0 if point_in_triangle(px, py, AA, AB, AC) else 0.0

    # Compose
    if pin > 0.0:
        # White pin, but cut a hole that shows the gradient underneath
        inside_hole = min(1.0, hole)
        pin_alpha = pin * (1.0 - inside_hole)
        arrow_alpha = inside_hole * arrow * pin
        r = base[0] * (1 - pin_alpha - arrow_alpha) + WHITE[0] * (pin_alpha + arrow_alpha)
        g = base[1] * (1 - pin_alpha - arrow_alpha) + WHITE[1] * (pin_alpha + arrow_alpha)
        b = base[2] * (1 - pin_alpha - arrow_alpha) + WHITE[2] * (pin_alpha + arrow_alpha)
        a = bg_alpha * max(pin, min(1.0, pin_alpha + arrow_alpha))
        # ensure alpha covers the pin shape fully
        a = bg_alpha if pin >= 1.0 else bg_alpha * pin
        return (r, g, b, a)

    return (base[0], base[1], base[2], bg_alpha)


def main():
    rows = []
    for y in range(SIZE):
        row = bytearray()
        for x in range(SIZE):
            ar = ag = ab = aa = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    px = x + (sx + 0.5) / SS
                    py = y + (sy + 0.5) / SS
                    r, g, b, a = sample(px, py)
                    ar += r
                    ag += g
                    ab += b
                    aa += a
            n = SS * SS
            r = int(round(ar / n))
            g = int(round(ag / n))
            b = int(round(ab / n))
            a = int(round(aa / n * 255))
            row += bytes((r, g, b, a))
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

    with open("assets/app-icon.png", "wb") as f:
        f.write(png)
    print("wrote assets/app-icon.png")


if __name__ == "__main__":
    main()
