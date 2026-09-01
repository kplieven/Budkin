#!/usr/bin/env python3
"""Compose the 1024x500 Play Store feature graphic.

    python3 scripts/screenshots/feature.py

Writes assets/store/feature/{light,dark}-1024x500.png plus a stacked preview.
Play takes exactly one, so pick a theme and upload that file; both are built so
the choice can be made by looking rather than by imagining.

The graphic is the banner above the screenshot carousel, and the thumbnail Play
uses wherever the app is promoted. It is NOT a screenshot collage: the mark, the
name and one line of what the app does have to survive being scaled down to a
card, so the type runs large and the artwork stays to one side.

Everything is the app's own: the gradient from gradient.py (built out of
`primary`, `sleep` and `diaper` from src/theme/tokens.ts), the mark from
assets/brand/budkin-mark.svg, the Figtree the app bundles, and a real capture
from assets/store/screenshots/device/.

Two constraints shape the layout, both learned from Play rather than taste:

- **The middle gets covered.** Some promo surfaces crop the graphic and lay the
  app icon and title over its centre. Mark and name therefore sit hard left
  inside TEXT_W, the capture sits hard right, and the band between them carries
  nothing but gradient.
- **Do not imply Baby Buddy affiliation** (Play's naming rule covers graphics,
  not just text), so the disclaimer is on the graphic itself rather than left to
  the description.

Needs numpy, Pillow and cairosvg. cairosvg is what rasterises the mark;
build-icons.py shells out to inkscape for the same job, but the screenshot
scripts are otherwise pure Python and it is not worth an inkscape install here.
"""

import argparse
import functools
import importlib.util
import io
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))  # so `gradient` resolves
from gradient import background, rgb  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
BRAND = ROOT / "assets/brand"
MARK = BRAND / "budkin-mark.svg"
SHOTS = ROOT / "assets/store/screenshots/device"
OUT = ROOT / "assets/store/feature"

FONTS = ROOT / "node_modules/@expo-google-fonts/figtree"
BOLD = FONTS / "800ExtraBold/Figtree_800ExtraBold.ttf"
MEDIUM = FONTS / "500Medium/Figtree_500Medium.ttf"

W, H = 1024, 500          # Play's only accepted size for a feature graphic
MARGIN = 72
TEXT_W = 400              # what SUB is hand-broken to; keeps the block
                          # clear of the centre band Play overlays
MARK_H = 76               # the painted mark's height, not its padded SVG box
MARK_GAP = 26
NAME_SIZE = 72
SUB_SIZE = 30
FINE_SIZE = 22
RADIUS = 26               # capture corners, scaled from frames.py's 44 at 1080
CROP_TOP = 100            # the status bar, exactly as frames.py drops it

NAME = "Budkin"
# Broken by hand rather than wrapped: at this width the natural break orphans
# "taps each" on a line of its own, and there are only two lines to get right.
SUB = ["Feeds, naps and diapers,", "two taps each"]
FINE = "Unofficial client for Baby Buddy"

# Wide-canvas blob layout. gradient.py's own recipe is placed against a 9:16
# slide; dropped onto a 2:1 banner its blobs sit off the bottom edge and the
# result flattens out. Same pigments, same strengths, new positions: warm behind
# the name, cool behind the capture, green a whisper below the floor.
BLOBS = {
    "light": [
        ("#D17A45", 0.13, 0.18, 0.40, 0.34),   # primary, warm, behind the name
        ("#7E6FC9", 0.88, 0.86, 0.42, 0.20),   # sleep, cool, under the capture
        ("#3E9D80", 0.50, 1.14, 0.34, 0.10),   # diaper, a green whisper
        ("#FFFCF8", 0.60, 0.10, 0.30, 0.18),   # surface, lifts the gap
    ],
    "dark": [
        ("#EC9A66", 0.12, 0.16, 0.42, 0.32),   # primary, an ember behind the name
        ("#A99EDC", 0.90, 0.88, 0.44, 0.22),
        ("#6FC0A6", 0.50, 1.24, 0.36, 0.07),
        ("#3A2E25", 0.58, 0.14, 0.32, 0.28),   # elevated, lifts the gap
    ],
}

# The marketing site's hero: a 135deg ramp with the app's dark-theme `primary`
# at the top-left corner, deepening to the bottom-right, under `onPrimary` text.
# Worth having as a candidate because the banner and the landing page are the
# two surfaces a stranger meets before the app itself, and matching them costs
# nothing. Keep in sync with the site if its hero is ever restyled.
HERO_STOPS = [(0.0, "#EC9A66"), (0.5, "#E98649"), (1.0, "#E57630")]
HERO_ANGLE = 135

THEMES = {
    # `shot` is a capture already in the theme being built: a light banner with
    # a dark screenshot on it reads as two products.
    "light": {
        "base": ("#FBF2E8", "#EBDAC6"),
        "text": (58, 46, 36),      # DAYLIGHT text
        "dim": (124, 108, 92),     # DAYLIGHT dim
        "faint": (168, 150, 132),  # DAYLIGHT faint
        "primary": "#D17A45",
        "secondary": "#E2AE8C",
        "shadow": 60,
        "shot": "01-home.png",
    },
    "dark": {
        "base": ("#181210", "#0C0908"),
        "text": (243, 235, 225),   # NIGHT text
        "dim": (180, 164, 146),    # NIGHT dim
        "faint": (124, 111, 97),   # NIGHT faint
        "primary": "#EC9A66",
        "secondary": "#EFBE9D",
        "shadow": 170,
        "shot": "history.png",
    },
    "hero": {
        "ramp": HERO_STOPS,
        "text": (42, 23, 11),      # #2A170B, the site's hero colour
        "dim": (110, 63, 27),      # #6E3F1B, its subheadline
        "faint": (120, 72, 34),    # between the two, so the fine print recedes
        # The mark cannot keep its terracotta on an orange field, so it takes the
        # hero's own two text colours: dark cradle, lighter leaf, same contrast
        # pairing the headline and subheadline already use.
        "primary": "#2A170B",
        "secondary": "#6E3F1B",
        "shadow": 80,
        "shot": "01-home.png",
    },
}


def ramp(stops, angle: int, w: int, h: int, seed: int = 7) -> Image.Image:
    """A CSS-style `linear-gradient(<angle>deg, ...)` as an opaque RGB image.

    Mixed in linear light and dithered, for the reasons gradient.py gives: a
    ramp this shallow bands visibly once quantised to 8 bits, and Play serves
    the PNG untouched.
    """
    rad = np.radians(angle)
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    # CSS measures the gradient line clockwise from "to top", and sizes it so
    # the corners land exactly on the 0 and 1 stops.
    length = abs(w * np.sin(rad)) + abs(h * np.cos(rad))
    t = (((xs - w / 2) * np.sin(rad) - (ys - h / 2) * np.cos(rad)) / length + 0.5)
    t = np.clip(t, 0, 1)[..., None]

    img = np.broadcast_to(rgb(stops[0][1]) ** 2.2, (h, w, 3)).astype(np.float32).copy()
    for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
        local = np.clip((t - p0) / (p1 - p0), 0, 1)
        img += (rgb(c1) ** 2.2 - rgb(c0) ** 2.2) * local
    img = np.clip(img, 0, 1) ** (1 / 2.2)

    rng = np.random.default_rng(seed)
    img += rng.random((h, w, 1), dtype=np.float32) / 255 - 0.5 / 255
    return Image.fromarray(np.clip(img * 255 + 0.5, 0, 255).astype(np.uint8), "RGB")


@functools.cache
def build_icons():
    """assets/brand/build-icons.py, by path: the hyphen keeps it off sys.path.

    Importing it rather than restating the recolour means a renamed brand colour
    breaks in one place, under that script's own assertions."""
    spec = importlib.util.spec_from_file_location("build_icons", BRAND / "build-icons.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def mark(theme: str, height: int) -> Image.Image:
    """The Budkin mark, recoloured for the theme, trimmed to what it paints.

    budkin-mark.svg is drawn to sit inside an icon tile, so its viewBox carries
    padding on every side and the cradle is wider than it is tall. Laying it out
    by that box puts the padding into the lockup and leaves the mark looking
    undersized beside the wordmark; cropping to the ink makes `height` mean the
    mark's own height, which is what the eye measures it by."""
    import cairosvg

    t = THEMES[theme]
    svg = MARK.read_text()
    if t["primary"].upper() != build_icons().TERRACOTTA:
        svg = build_icons().variant(svg, t["primary"], t["secondary"])
    png = cairosvg.svg2png(bytestring=svg.encode(), output_width=1024, output_height=1024)
    ink = Image.open(io.BytesIO(png)).convert("RGBA")
    ink = ink.crop(ink.getbbox())
    return ink.resize((round(ink.width * height / ink.height), height), Image.LANCZOS)


def compose(theme: str) -> Image.Image:
    t = THEMES[theme]
    canvas = (ramp(t["ramp"], HERO_ANGLE, W, H) if "ramp" in t
              else background(theme, W, H, spec={"base": t["base"], "blobs": BLOBS[theme]}))
    draw = ImageDraw.Draw(canvas)

    name_font = ImageFont.truetype(str(BOLD), NAME_SIZE)
    sub_font = ImageFont.truetype(str(MEDIUM), SUB_SIZE)
    fine_font = ImageFont.truetype(str(MEDIUM), FINE_SIZE)

    # Measure the ink, not the line box: Figtree's box carries slack above the
    # ascender, and "Budkin" has no descender, so glyphs aligned on the box sit
    # low against the mark. `nx`/`ny` cancel that offset back out.
    logo = mark(theme, MARK_H)
    nx, ny, nx1, ny1 = draw.textbbox((0, 0), NAME, font=name_font)
    name_h = ny1 - ny
    row_h = max(MARK_H, name_h)
    sub_step = int(SUB_SIZE * 1.34)
    block_h = row_h + 26 + len(SUB) * sub_step + 18 + FINE_SIZE
    y = (H - block_h) // 2

    canvas.paste(logo, (MARGIN, y + (row_h - MARK_H) // 2), logo)
    draw.text((MARGIN + logo.width + MARK_GAP - nx, y + (row_h - name_h) // 2 - ny),
              NAME, font=name_font, fill=t["text"])
    y += row_h + 26

    for line in SUB:
        draw.text((MARGIN, y), line, font=sub_font, fill=t["dim"])
        y += sub_step
    draw.text((MARGIN, y + 18), FINE, font=fine_font, fill=t["faint"])

    # The capture runs off the bottom edge. A whole phone shrunk to fit 500px
    # would be 230px wide and unreadable; cut off, the part that survives is
    # legible and the crop reads as intentional.
    shot = Image.open(SHOTS / t["shot"]).convert("RGB")
    shot = shot.crop((0, CROP_TOP, shot.width, shot.height))
    shot_h = 720
    shot_w = round(shot.width * shot_h / shot.height)
    shot = shot.resize((shot_w, shot_h), Image.LANCZOS)
    x, top = W - MARGIN - shot_w, 62

    mask = Image.new("L", (shot_w, shot_h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, shot_w - 1, shot_h - 1), RADIUS, fill=255)

    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shadow.paste(Image.new("RGBA", (shot_w, shot_h), (0, 0, 0, t["shadow"])), (x, top + 12), mask)
    canvas = Image.alpha_composite(
        canvas.convert("RGBA"), shadow.filter(ImageFilter.GaussianBlur(20))
    ).convert("RGB")
    canvas.paste(shot, (x, top), mask)
    return canvas


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()
    out = args.out if args.out.is_absolute() else ROOT / args.out

    if not BOLD.exists():
        print(f"Figtree missing at {FONTS} (run npm install)", file=sys.stderr)
        return 1
    out.mkdir(parents=True, exist_ok=True)

    made = []
    for theme in THEMES:
        im = compose(theme)
        dst = out / f"{theme}-{W}x{H}.png"
        im.save(dst, "PNG", optimize=True)
        made.append(im)
        size = dst.stat().st_size
        # Play's rules for this slot: exactly 1024x500, 24-bit, no alpha, <15MB.
        ok = im.size == (W, H) and Image.open(dst).mode == "RGB" and size <= 15 * 1024 * 1024
        print(f"{dst.name:<22} {W}x{H}  {size / 1024:6.0f} KB  {'OK' if ok else 'FAIL'}")

    preview = Image.new("RGB", (W, H * len(made)))
    for i, im in enumerate(made):
        preview.paste(im, (0, i * H))
    preview.save(out / "preview.png", "PNG", optimize=True)
    print(f"\n{len(made)} feature graphics in {out.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
