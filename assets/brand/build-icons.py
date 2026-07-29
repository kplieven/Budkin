#!/usr/bin/env python3
"""Regenerate every Budkin icon from assets/brand/budkin-mark.svg.

Run after editing the mark:

    python3 assets/brand/build-icons.py

Needs `inkscape` (rasterising) and ImageMagick `convert` (compositing).
"""

import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

BRAND = Path(__file__).resolve().parent
ROOT = BRAND.parent.parent
IMAGES = ROOT / "assets" / "images"
SOURCE = BRAND / "budkin-mark.svg"

# The mark uses two solid colours: a primary for the cradle, stem and left leaf,
# and a lighter secondary for the right leaf. Each theme maps both. Nothing is
# translucent, so the mark looks the same over any background.
TERRACOTTA = "#D17A45"   # primary, light theme
TERRACOTTA_LIGHT = "#E2AE8C"
CREAM = "#F6EDE3"        # background, light theme
AMBER = "#EC9A66"        # primary, dark theme
AMBER_LIGHT = "#EFBE9D"
DARK_BG = "#16110E"      # background, dark theme

# An Android adaptive layer is 108dp. The launcher mask shows the inner 72dp
# viewport, and Google's stricter guidance keeps key content inside a 66dp circle.
# The mark's furthest painted point sits at 50.70 of its 100 design units (a
# cradle arm-tip cap), which caps the mark at 617px against the 66dp circle and
# 673px against the 72dp one on a 1024 canvas.
#
# We sit just inside the 72dp viewport. The 66dp figure is the cautious reading
# and left the round icon noticeably smaller than the square one; every mask in
# common use (circle, squircle, rounded square) contains the 72dp circle, since
# a circle is the tightest of them. A rare "cylinder" mask is narrower than the
# viewport and would shave the arm tips.
ADAPTIVE_CANVAS = 1024
MARK_EXTENT_UNITS = 50.70                                # furthest painted point
MARK_WIDTH_UNITS = 86.62                                 # bbox width
SAFE_RADIUS_PX = (66 / 108) / 2 * ADAPTIVE_CANVAS        # 313
VIEWPORT_RADIUS_PX = (72 / 108) / 2 * ADAPTIVE_CANVAS    # 341
ADAPTIVE_TARGET_RADIUS_PX = 336                          # a hair inside the viewport
ADAPTIVE_MARK = round(ADAPTIVE_TARGET_RADIUS_PX / (MARK_EXTENT_UNITS / 100))

# Centring the mark's bounding box is right in a square and wrong in a circle.
# The cradle's arm-tip caps are the mark's widest AND highest points, so they run
# at the circle's tight upper diagonals while the bowl floats far from the bottom:
# bbox-centred, the rim clearance is 5px at the arms and 135px under the bowl,
# which reads as the mark sitting high even though it measures dead centre.
#
# These are the mark's extremes in design units from its bbox centre. Solving
# "clearance at the arm equals clearance under the bowl" for a downward shift d:
#     sqrt(H^2 + (V-d)^2) + R = B + d   ->   d = (H^2 + V^2 - (B-R)^2) / (2(B-R+V))
CAP_H, CAP_V, CAP_R = 36.6, 24.4, 6.71   # arm-tip cap centre offset, and its radius
BOWL_DEPTH = 31.11                       # lowest painted point
OPTICAL_SHIFT_UNITS = ((CAP_H ** 2 + CAP_V ** 2 - (BOWL_DEPTH - CAP_R) ** 2)
                       / (2 * (BOWL_DEPTH - CAP_R + CAP_V)))
ADAPTIVE_SHIFT_PX = round(OPTICAL_SHIFT_UNITS / 100 * ADAPTIVE_MARK)

# Browsers never mask a favicon, and at 16-32px it needs more mark and less
# padding than the app icon does. This one deliberately runs larger than the
# 86.7% of tile width that the square icon uses.
FAVICON_CANVAS = 256
FAVICON_MARK_SHARE = 0.90
FAVICON_MARK = round(FAVICON_CANVAS * FAVICON_MARK_SHARE / (MARK_WIDTH_UNITS / 100))


def run(cmd):
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit(f"failed: {' '.join(str(c) for c in cmd)}\n{result.stderr}")


def variant(svg_text, primary, secondary):
    """Recolour the mark. Asserts every substitution matched so that renaming a
    colour in the source fails loudly here instead of silently shipping stale art."""
    out, n = re.subn(f'"{TERRACOTTA}"', f'"{primary}"', svg_text)
    assert n == 3, f"expected 3 primary fills, found {n}"
    out, n = re.subn(f'"{TERRACOTTA_LIGHT}"', f'"{secondary}"', out)
    assert n == 1, f"expected 1 secondary fill, found {n}"
    return out


def rasterise(svg_path, png_path, size):
    run(["inkscape", str(svg_path), "-o", str(png_path),
         "-w", str(size), "-h", str(size), "--export-background-opacity=0"])


def compose(mark_png, out_path, canvas, background=None, radius=None, drop_alpha=False,
            shift_y=0):
    cmd = ["convert", "-size", f"{canvas}x{canvas}"]
    if background and radius is None:
        cmd += [f"xc:{background}"]
    else:
        cmd += ["xc:none"]
        if background and radius is not None:
            cmd += ["-fill", background, "-draw",
                    f"roundrectangle 0,0,{canvas - 1},{canvas - 1},{radius},{radius}"]
    cmd += [str(mark_png), "-gravity", "center"]
    if shift_y:
        cmd += ["-geometry", f"+0+{shift_y}"]
    cmd += ["-composite"]
    if drop_alpha:
        cmd += ["-background", background or CREAM, "-alpha", "remove", "-alpha", "off"]
    cmd += ["-depth", "8", str(out_path)]
    run(cmd)


def main():
    for tool in ("inkscape", "convert"):
        if not shutil.which(tool):
            sys.exit(f"{tool} not found on PATH")

    svg = SOURCE.read_text()
    written = []

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)

        light_svg = SOURCE
        dark_svg = tmp / "mark-dark.svg"
        dark_svg.write_text(variant(svg, AMBER, AMBER_LIGHT))
        # Android tints the monochrome layer from its alpha, so both leaves have
        # to be one flat opaque colour or the lighter leaf renders half-faded.
        mono_svg = tmp / "mark-mono.svg"
        mono_svg.write_text(variant(svg, "#000000", "#000000"))

        # Full-bleed square. The OS masks the corners itself, so this must not be
        # pre-rounded or the mask cuts into cream that is already gone.
        mark_1024 = tmp / "mark-1024.png"
        rasterise(light_svg, mark_1024, 1024)
        compose(mark_1024, IMAGES / "icon.png", 1024, background=CREAM)
        written.append(IMAGES / "icon.png")

        # Play Store listing icon: 512x512, no alpha channel.
        mark_512 = tmp / "mark-512.png"
        rasterise(light_svg, mark_512, 512)
        compose(mark_512, BRAND / "play-store-icon.png", 512, background=CREAM, drop_alpha=True)
        written.append(BRAND / "play-store-icon.png")

        # Android adaptive layers. Both take the same optical shift, or the themed
        # icon drifts out of register with the colour one.
        mark_safe = tmp / "mark-safe.png"
        rasterise(light_svg, mark_safe, ADAPTIVE_MARK)
        compose(mark_safe, IMAGES / "android-icon-foreground.png", ADAPTIVE_CANVAS,
                shift_y=ADAPTIVE_SHIFT_PX)
        written.append(IMAGES / "android-icon-foreground.png")

        mono_safe = tmp / "mono-safe.png"
        rasterise(mono_svg, mono_safe, ADAPTIVE_MARK)
        compose(mono_safe, IMAGES / "android-icon-monochrome.png", ADAPTIVE_CANVAS,
                shift_y=ADAPTIVE_SHIFT_PX)
        written.append(IMAGES / "android-icon-monochrome.png")

        run(["convert", "-size", f"{ADAPTIVE_CANVAS}x{ADAPTIVE_CANVAS}", f"xc:{CREAM}",
             str(IMAGES / "android-icon-background.png")])
        written.append(IMAGES / "android-icon-background.png")

        # Splash marks sit on a flat background set in app.json, so they stay
        # transparent and expo-splash-screen scales them to imageWidth.
        shutil.copyfile(mark_1024, IMAGES / "splash-icon.png")
        written.append(IMAGES / "splash-icon.png")
        rasterise(dark_svg, IMAGES / "splash-icon-dark.png", 1024)
        written.append(IMAGES / "splash-icon-dark.png")

        # Favicon keeps its rounded tile: browsers do not mask it.
        mark_fav = tmp / "mark-favicon.png"
        rasterise(light_svg, mark_fav, FAVICON_MARK)
        compose(mark_fav, IMAGES / "favicon.png", FAVICON_CANVAS, background=CREAM, radius=56)
        written.append(IMAGES / "favicon.png")

        # Measure what actually landed on disk rather than trusting the arithmetic.
        # Keying out the cream first means this works on the opaque tiles too,
        # where the alpha channel alone has nothing to trim against.
        def bbox_of(path):
            out = subprocess.run(
                ["convert", str(path), "-fuzz", "2%", "-transparent", CREAM,
                 "-alpha", "extract", "-threshold", "1",
                 "-trim", "-format", "%w %h %X %Y", "info:"],
                capture_output=True, text=True).stdout.split()
            return [int(v) for v in out]

        w, h, x, y = bbox_of(IMAGES / "android-icon-foreground.png")
        unit = ADAPTIVE_MARK / 100
        arm = ((CAP_H * unit) ** 2 + (CAP_V * unit - ADAPTIVE_SHIFT_PX) ** 2) ** 0.5 + CAP_R * unit
        bowl = BOWL_DEPTH * unit + ADAPTIVE_SHIFT_PX
        assert max(arm, bowl) <= VIEWPORT_RADIUS_PX, (
            f"mark reaches {max(arm, bowl):.0f}px, past the "
            f"{VIEWPORT_RADIUS_PX:.0f}px mask viewport")
        print(f"adaptive foreground: mark {w}x{h}px, shifted down {ADAPTIVE_SHIFT_PX}px "
              f"({OPTICAL_SHIFT_UNITS:.1f} design units) to balance the circle")
        print(f"                     rim clearance {VIEWPORT_RADIUS_PX - arm:.0f}px at the arms, "
              f"{VIEWPORT_RADIUS_PX - bowl:.0f}px under the bowl "
              f"(bbox-centred it would be {VIEWPORT_RADIUS_PX - MARK_EXTENT_UNITS * unit:.0f} "
              f"and {VIEWPORT_RADIUS_PX - BOWL_DEPTH * unit:.0f})")

        # The favicon's tile is rounded and its mark now runs close to the edge,
        # so check the mark's own coverage against the tile mask directly. Any
        # pixel that is opaque in the mark but outside the mask is a clipped arm.
        # (Comparing pixel counts between a square and a rounded tile does not
        # work: the antialiased cream-to-transparent corner edge is neither cream
        # nor mark, so it lands on whichever side of the comparison you key out.)
        mark_alpha = tmp / "fav-mark-alpha.png"
        tile_mask = tmp / "fav-tile-mask.png"
        run(["convert", "-size", f"{FAVICON_CANVAS}x{FAVICON_CANVAS}", "xc:none",
             str(mark_fav), "-gravity", "center", "-composite",
             "-alpha", "extract", str(mark_alpha)])
        run(["convert", "-size", f"{FAVICON_CANVAS}x{FAVICON_CANVAS}", "xc:none",
             "-fill", "white", "-draw",
             f"roundrectangle 0,0,{FAVICON_CANVAS - 1},{FAVICON_CANVAS - 1},56,56",
             "-alpha", "extract", str(tile_mask)])
        # mark AND NOT tile. Multiply rather than Minus: Minus takes its operands
        # in an order that is easy to get backwards, and backwards it silently
        # measures the tile's empty space instead of the clipped arms.
        outside = float(subprocess.run(
            ["convert", str(mark_alpha), "(", str(tile_mask), "-negate", ")",
             "-compose", "Multiply", "-composite",
             "-threshold", "25%", "-format", "%[fx:mean*w*h]", "info:"],
            capture_output=True, text=True).stdout)
        assert outside == 0, f"the rounded corners clip {outside:.0f}px of the favicon mark"
        # Measure the mark's own alpha, not the finished favicon: the tile's
        # antialiased corner edge is neither cream nor mark and survives the
        # key-out, which reports the full canvas as the mark.
        fw, fh, _, _ = [int(v) for v in subprocess.run(
            ["convert", str(mark_alpha), "-threshold", "1", "-trim",
             "-format", "%w %h %X %Y", "info:"],
            capture_output=True, text=True).stdout.split()]
        print(f"favicon: mark {fw}x{fh}px on a {FAVICON_CANVAS}px tile "
              f"({fw / FAVICON_CANVAS * 100:.0f}% of tile width), "
              f"{outside:.0f}px of it outside the rounded corners")

    for path in written:
        print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
