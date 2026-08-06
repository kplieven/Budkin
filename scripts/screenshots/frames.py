#!/usr/bin/env python3
"""Compose the finished Play listing slides from the flat captures.

    python3 scripts/screenshots/frames.py

Reads assets/store/screenshots/NN-*.png (written by finalize.py) and writes
assets/store/screenshots/slides/NN-*.png: the same capture on a branded
background under a short headline, still 1080x1920 and still 24-bit with no
alpha, so the slides upload exactly like the plain captures.

Colours and type are the app's own, read off src/theme/tokens.ts and the
Figtree family the app bundles, so the gallery, the app and the landing page
look like one product rather than three.

Captions state only what the screenshot shows. Play rejects listing images
whose claims the app does not back up, and every line here is visible in the
frame beneath it.
"""

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "assets/store/screenshots"
OUT = SRC / "slides"

FONTS = ROOT / "node_modules/@expo-google-fonts/figtree"
BOLD = FONTS / "800ExtraBold/Figtree_800ExtraBold.ttf"
MEDIUM = FONTS / "500Medium/Figtree_500Medium.ttf"

# Text colours are the app's own (src/theme/tokens.ts, DAYLIGHT and NIGHT). The
# slide background is deliberately NOT the app's `bg`: a capture on its own
# background disappears into the slide, leaving the rounded frame readable only
# where the shadow falls. Light uses the theme's `chip` a shade deeper than the
# app cream; dark goes a shade below the app's near-black.
THEMES = {
    "light": {"bg": (241, 230, 216), "text": (58, 46, 36), "dim": (124, 108, 92), "shadow": 46},
    "dark": {"bg": (13, 10, 8), "text": (243, 235, 225), "dim": (180, 164, 146), "shadow": 150},
}

W, H = 1080, 1920
MARGIN = 84
SHOT_W = 872
HEAD_TOP = 104
HEAD_SIZE = 62
SUB_SIZE = 34
RADIUS = 44

# headline, subline, theme
SLIDES = {
    "01-home": ("Your baby's day, at a glance", "Feeds, naps, diapers and more, two taps each", "light"),
    "02-log-feeding": ("Log a feed in two taps", "The defaults are ready before you are", "light"),
    "03-history": ("Kind to your eyes at 3am", "The whole timeline, in light or dark", "dark"),
    "04-growth": ("Growth against the WHO curves", "Weight, length and head circumference", "light"),
    "05-insights": ("Watch the rhythm appear", "Sleep, feeds and diapers over weeks", "light"),
    "06-milestones": ("Catch the firsts", "27 milestones with typical age windows", "light"),
    "07-children": ("Twins? One tap to switch", "Every child keeps their own history", "light"),
    "08-local-mode": ("No account, no server needed", "Local mode keeps it all on the phone", "light"),
    # Alternates, framed too so a swap needs no extra work.
    "alt-notes": ("Room for the small things", "The moments a tracker usually loses", "light"),
    "alt-timers": ("Start a timer, forget about it", "It keeps running while you do", "light"),
}


def wrap(draw, text, font, max_width):
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=font) <= max_width or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def headline_block(draw, text, max_width):
    """Largest size at which the headline fits two lines, down to 44px."""
    for size in range(HEAD_SIZE, 43, -2):
        font = ImageFont.truetype(str(BOLD), size)
        lines = wrap(draw, text, font, max_width)
        if len(lines) <= 2:
            return font, lines
    font = ImageFont.truetype(str(BOLD), 44)
    return font, wrap(draw, text, font, max_width)


def compose(src: Path, headline: str, subline: str, theme: str,
            crop_top: int = 0, crop_bottom: int = 0) -> Image.Image:
    t = THEMES[theme]
    canvas = Image.new("RGB", (W, H), t["bg"])
    draw = ImageDraw.Draw(canvas)

    font, lines = headline_block(draw, headline, W - 2 * MARGIN)
    y = HEAD_TOP
    for line in lines:
        draw.text((MARGIN, y), line, font=font, fill=t["text"])
        y += int(font.size * 1.16)

    sub_font = ImageFont.truetype(str(MEDIUM), SUB_SIZE)
    y += 10
    for line in wrap(draw, subline, sub_font, W - 2 * MARGIN):
        draw.text((MARGIN, y), line, font=sub_font, fill=t["dim"])
        y += int(SUB_SIZE * 1.3)

    # Fit the capture to the width AND to what is left under the headline. Web
    # captures are 9:16 and bounded by the width; a phone screenshot is taller
    # (1080x2340 on a Galaxy S24) and is bounded by the height instead.
    shot = Image.open(src).convert("RGB")
    if crop_top or crop_bottom:
        shot = shot.crop((0, crop_top, shot.width, shot.height - crop_bottom))
    avail_h = H - (y + 46) - 34
    ratio = min(SHOT_W / shot.width, avail_h / shot.height)
    shot_w, shot_h = round(shot.width * ratio), round(shot.height * ratio)
    shot = shot.resize((shot_w, shot_h), Image.LANCZOS)

    # Rounded corners, so the capture reads as a device rather than a pasted
    # rectangle. The mask is also what the shadow is built from.
    mask = Image.new("L", (shot_w, shot_h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, shot_w - 1, shot_h - 1), RADIUS, fill=255)

    x = (W - shot_w) // 2
    top = max(y + 46, H - shot_h - 34)

    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shadow.paste(Image.new("RGBA", (shot_w, shot_h), (0, 0, 0, t["shadow"])), (x, top + 16), mask)
    canvas = Image.alpha_composite(
        canvas.convert("RGBA"), shadow.filter(ImageFilter.GaussianBlur(26))
    ).convert("RGB")

    canvas.paste(shot, (x, top), mask)
    return canvas


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=SRC,
                    help="directory of flat captures (default: the web set)")
    ap.add_argument("--out", type=Path, default=None,
                    help="where slides go (default: <src>/slides)")
    ap.add_argument("--crop-top", type=int, default=0,
                    help="pixels to trim off the top of each capture. Use it on "
                         "phone screenshots to drop the status bar, whose clock, "
                         "carrier and charging battery are noise in a listing "
                         "(and which AOSP demo mode cannot clean up on One UI)")
    ap.add_argument("--crop-bottom", type=int, default=0,
                    help="pixels to trim off the bottom, e.g. a gesture pill")
    args = ap.parse_args()
    src_dir = args.src if args.src.is_absolute() else ROOT / args.src
    out_dir = args.out or (src_dir / "slides")
    if not out_dir.is_absolute():
        out_dir = ROOT / out_dir

    if not BOLD.exists():
        print(f"Figtree missing at {FONTS} (run npm install)", file=sys.stderr)
        return 1
    out_dir.mkdir(parents=True, exist_ok=True)

    made = 0
    for stem, (headline, subline, theme) in SLIDES.items():
        src = src_dir / f"{stem}.png"
        if not src.exists():
            print(f"missing capture {src.name}, skipped", file=sys.stderr)
            continue
        dst = out_dir / f"{stem}.png"
        compose(src, headline, subline, theme,
                args.crop_top, args.crop_bottom).save(dst, "PNG", optimize=True)
        size = dst.stat().st_size
        ok = Image.open(dst).mode == "RGB" and size <= 8 * 1024 * 1024
        print(f"{dst.name:<22} {W}x{H}  {size / 1024:6.0f} KB  {theme:<5} {'OK' if ok else 'FAIL'}")
        made += 1

    print(f"\n{made} slides in {out_dir.relative_to(ROOT)}")
    return 0 if made else 1


if __name__ == "__main__":
    raise SystemExit(main())
