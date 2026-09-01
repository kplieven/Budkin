#!/usr/bin/env python3
"""The branded gradient the listing slides sit on.

    python3 scripts/screenshots/gradient.py

Writes assets/store/screenshots/backgrounds/{light,dark}-1080x1920.png plus a
side-by-side preview, and exports `background()` for frames.py to paint on.

It is a mesh gradient: a vertical base ramp with a few soft colour blobs
floated over it. Every colour is the app's own (src/theme/tokens.ts) -- the
warm one is `primary`, the cool ones are the `sleep` and `diaper` activity
hues, so the backdrop is made of the same pigments as the screenshot in front
of it. Blending happens in linear light, not sRGB, which is what keeps the
warm-to-cool crossover from going grey in the middle.
"""

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets/store/screenshots/backgrounds"

W, H = 1080, 1920


def rgb(hex_str):
    h = hex_str.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])


# base = (top, bottom) of the vertical ramp; blobs = (colour, cx, cy, radius,
# strength), all in fractions of the canvas so the recipe is resolution-free.
# Light stays a shade deeper than the app's cream and dark a shade below its
# near-black, for the same reason frames.py did it with flat colour: a capture
# on its own background would dissolve into the slide.
THEMES = {
    "light": {
        "base": ("#FBF2E8", "#EBDAC6"),
        "blobs": [
            ("#D17A45", 0.16, 0.06, 0.72, 0.30),   # primary, warm, behind the headline
            ("#7E6FC9", 0.94, 0.82, 0.66, 0.20),   # sleep, cool counterweight
            ("#3E9D80", 0.10, 1.02, 0.48, 0.11),   # diaper, a green whisper at the foot
            ("#FFFCF8", 0.62, 0.34, 0.42, 0.22),   # surface, lifts the middle
        ],
    },
    "dark": {
        "base": ("#181210", "#0C0908"),
        "blobs": [
            ("#EC9A66", 0.14, 0.04, 0.78, 0.30),   # primary, an ember top-left
            ("#A99EDC", 0.98, 0.86, 0.70, 0.22),   # sleep, cool counterweight
            ("#6FC0A6", 0.06, 1.04, 0.50, 0.10),   # diaper, a green whisper at the foot
            ("#3A2E25", 0.58, 0.40, 0.46, 0.30),   # elevated, lifts the middle
        ],
    },
}


def background(theme: str, w: int = W, h: int = H, seed: int = 7, spec=None) -> Image.Image:
    """Render the gradient as an opaque RGB image.

    `spec` overrides the theme's recipe for callers whose canvas is not 9:16.
    The blob positions here are placed against a tall slide, and a wide canvas
    wants its own; feature.py passes one.
    """
    spec = spec or THEMES[theme]
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    xs /= w
    ys /= h

    # Linear light throughout, so mixing behaves like light rather than like
    # paint. sRGB is only put back on at the end.
    top, bottom = (rgb(c) ** 2.2 for c in spec["base"])
    ramp = smoothstep(ys)[..., None]
    img = top * (1 - ramp) + bottom * ramp

    # Aspect-corrected distance, so a blob is a circle on a 9:16 canvas instead
    # of an ellipse stretched down the slide.
    aspect = h / w
    for hex_str, cx, cy, radius, strength in spec["blobs"]:
        d = np.sqrt((xs - cx) ** 2 + ((ys - cy) * aspect) ** 2) / radius
        falloff = smoothstep(np.clip(1 - d, 0, 1)) ** 1.5
        img += (rgb(hex_str) ** 2.2 - img) * (falloff * strength)[..., None]

    img = np.clip(img, 0, 1) ** (1 / 2.2)

    # A gradient this shallow bands badly once it is quantised to 8 bits, and
    # Play serves the PNG as-is. Half a level of noise dithers it away and is
    # invisible at any zoom.
    rng = np.random.default_rng(seed)
    img += rng.random((h, w, 1), dtype=np.float32) / 255 - 0.5 / 255
    return Image.fromarray(np.clip(img * 255 + 0.5, 0, 255).astype(np.uint8), "RGB")


def smoothstep(t):
    return t * t * (3 - 2 * t)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", default=f"{W}x{H}", help="WxH, default 1080x1920")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()
    w, h = (int(v) for v in args.size.lower().split("x"))
    out = args.out if args.out.is_absolute() else ROOT / args.out
    out.mkdir(parents=True, exist_ok=True)

    made = []
    for theme in THEMES:
        im = background(theme, w, h)
        dst = out / f"{theme}-{w}x{h}.png"
        im.save(dst, "PNG", optimize=True)
        made.append(im)
        print(f"{dst.name:<24} {w}x{h}  {dst.stat().st_size / 1024:6.0f} KB")

    preview = Image.new("RGB", (w * len(made), h))
    for i, im in enumerate(made):
        preview.paste(im, (i * w, 0))
    preview.thumbnail((1400, 1400), Image.LANCZOS)
    preview.save(out / "preview.png", "PNG", optimize=True)
    print(f"\n{len(made)} backgrounds in {out.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
