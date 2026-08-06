#!/usr/bin/env python3
"""Turn the raw captures into uploadable Play assets, and prove they qualify.

    python3 scripts/screenshots/finalize.py

Reads assets/store/screenshots/raw/NN-*.png, writes assets/store/screenshots/.

Play's rules (support.google.com/googleplay/android-developer/answer/9866151):
24-bit PNG or JPEG with NO alpha channel, each side 320..3840px, long side no
more than twice the short one, 8MB max. Chromium usually writes an opaque RGB
PNG already, but "usually" is not something to upload on: every file is
flattened onto the theme background and then checked, so a run that prints OK
is a run whose files the console will accept.
"""

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "assets/store/screenshots/raw"
OUT = ROOT / "assets/store/screenshots"

# Matches the app's own surfaces, so a flattened edge pixel cannot show a seam.
BACKGROUNDS = {"light": (246, 237, 227), "dark": (22, 17, 14)}
DARK_SHOTS = {"03-history"}

MIN_SIDE, MAX_SIDE, MAX_BYTES = 320, 3840, 8 * 1024 * 1024


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    # Numbered captures are the listing set; `alt-` ones are alternates kept
    # ready to swap in, and they go through the same checks.
    files = sorted(RAW.glob("*.png"))
    if not files:
        print(f"no captures in {RAW}", file=sys.stderr)
        return 1

    failures = []
    for src in files:
        theme = "dark" if src.stem in DARK_SHOTS else "light"
        im = Image.open(src)
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGBA")
            flat = Image.new("RGB", im.size, BACKGROUNDS[theme])
            flat.paste(im, mask=im.split()[-1])
            im = flat
        else:
            im = im.convert("RGB")

        dst = OUT / src.name
        im.save(dst, "PNG", optimize=True)

        w, h = im.size
        size = dst.stat().st_size
        problems = []
        if not (MIN_SIDE <= w <= MAX_SIDE and MIN_SIDE <= h <= MAX_SIDE):
            problems.append(f"side out of {MIN_SIDE}..{MAX_SIDE}")
        if max(w, h) > 2 * min(w, h):
            problems.append("long side more than 2x the short side")
        if size > MAX_BYTES:
            problems.append(f"{size / 1e6:.1f}MB over the 8MB limit")
        if Image.open(dst).mode != "RGB":
            problems.append("not 24-bit RGB")

        status = "OK" if not problems else "FAIL: " + "; ".join(problems)
        print(f"{dst.name:<22} {w}x{h}  {size / 1024:6.0f} KB  {theme:<5} {status}")
        if problems:
            failures.append(dst.name)

    numbered = [p for p in files if p.stem[0].isdigit()]
    print(f"\n{len(files)} screenshots ({len(numbered)} in the listing set), {len(failures)} rejected by the checks")
    if len(numbered) < 4:
        print("note: Play wants at least 4 at 1080px+ for promotional eligibility")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
