#!/usr/bin/env python3
"""Capture the screenshot set from the app running on a USB-connected phone.

    python3 scripts/screenshots/captureDevice.py [--only home insights]

Assumes seedDevice.py has already written the fixture and that Metro is running
(`npx expo start --dev-client`), since a development build loads its JS from the
bundler. Writes assets/store/screenshots/device/NN-name.png at whatever
resolution the phone has.

Navigation is by deep link wherever the app has a route, which is steadier than
tapping coordinates. The child switcher has no route, so it is opened by tapping
the header, whose bounds are read from a uiautomator dump rather than guessed.

The scheme is `budkindev`, not `budkin`: app.config.js gives the development
variant its own scheme precisely so two installed builds cannot fight over the
same links.
"""

import argparse
import os
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets/store/screenshots/device"
PKG = "dev.karellievens.budkin.dev"
SCHEME = "budkindev"
ADB = os.environ.get("ADB", str(Path.home() / "Android/Sdk/platform-tools/adb"))

# `anchor` is text that proves the route actually rendered. A deep link fired at
# a freshly launched app is sometimes swallowed while it is still starting up,
# which silently leaves the previous screen in frame, so every navigation is
# verified and retried rather than assumed to have worked.
SHOTS = [
    {"id": "home", "file": "01-home", "route": "/", "theme": "light", "anchor": "LOG ACTIVITY"},
    # `modal` shots open a sheet ON TOP of the current screen. A deep link
    # navigates the screen UNDERNEATH it and leaves the sheet up, so every later
    # capture would be taken through it; Back closes it before moving on.
    {"id": "log", "file": "02-log-feeding", "route": "log/feeding", "theme": "light", "modal": True, "anchor": "Log feeding"},
    {"id": "history", "file": "03-history", "route": "history", "theme": "dark", "anchor": "All activities"},
    {"id": "growth", "file": "04-growth", "route": "metric/weight", "theme": "light", "anchor": "WHO reference"},
    {"id": "insights", "file": "05-insights", "route": "insights", "theme": "light", "anchor": "Rhythm"},
    {"id": "milestones", "file": "06-milestones", "route": "milestones", "theme": "light", "anchor": "reached"},
    # No route of its own: the sheet opens from the header on Home.
    {"id": "children", "file": "07-children", "route": "/", "theme": "light", "tap": "switch child", "modal": True, "anchor": "LOG ACTIVITY"},
    # Only reachable while first-run setup is unseen: seed with --no-tutorial.
    {"id": "welcome", "file": "08-local-mode", "route": "welcome", "theme": "light", "anchor": "Do you have a Baby Buddy server?"},
    {"id": "notes", "file": "alt-notes", "route": "notes", "theme": "light", "anchor": "Add note"},
    # `/timers` is a web URL, not a native deep link: firing it leaves the app
    # where it was. Reached the way a user does, from Home.
    {"id": "timers", "file": "alt-timers", "route": "/", "theme": "light", "anchor": "LOG ACTIVITY", "tap": "Timers"},
]

# The theme and `tutorialSeen` both live in the seeded prefs, so a full device
# set is three passes, each one seed followed by one capture:
#
#   seedDevice.py --theme light --day-start <hour>
#   captureDevice.py --theme light
#   seedDevice.py --theme dark  --day-start <hour>
#   captureDevice.py --only history
#   seedDevice.py --theme light --day-start <hour> --tutorial false
#   captureDevice.py --only welcome


def adb(*args, binary=False, check=True):
    out = subprocess.run([ADB, *args], capture_output=True, check=False)
    if check and out.returncode != 0:
        sys.exit(f"adb {' '.join(args)} failed:\n{out.stderr.decode(errors='replace')}")
    return out.stdout if binary else out.stdout.decode(errors="replace").strip()


def demo_mode(on: bool):
    """AOSP status-bar demo mode: a fixed clock, full battery, no notification
    icons. Not every OEM skin honours it, so failures here are ignored rather
    than fatal; the worst case is a real status bar in the shot."""
    if on:
        subprocess.run([ADB, "shell", "settings", "put", "global", "sysui_demo_allowed", "1"],
                       capture_output=True)
        cmds = [
            ["-e", "command", "enter"],
            ["-e", "command", "clock", "-e", "hhmm", "1145"],
            ["-e", "command", "battery", "-e", "level", "100", "-e", "plugged", "false"],
            ["-e", "command", "network", "-e", "wifi", "show", "-e", "level", "4"],
            ["-e", "command", "network", "-e", "mobile", "show", "-e", "level", "4"],
            ["-e", "command", "notifications", "-e", "visible", "false"],
        ]
    else:
        cmds = [["-e", "command", "exit"]]
    for c in cmds:
        subprocess.run(
            [ADB, "shell", "am", "broadcast", "-a", "com.android.systemui.demo", *c],
            capture_output=True,
        )


def open_route(route: str):
    url = f"{SCHEME}://{route}"
    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url, PKG)


def dump_tree():
    adb("shell", "uiautomator", "dump", "/sdcard/ui.xml")
    xml = adb("exec-out", "cat", "/sdcard/ui.xml", binary=True).decode(errors="replace")
    return ET.fromstring(xml)


def node_center(node):
    m = re.match(r"\[(\d+),(\d+)]\[(\d+),(\d+)]", node.get("bounds", ""))
    if not m:
        return None
    x1, y1, x2, y2 = map(int, m.groups())
    return (x1 + x2) // 2, (y1 + y2) // 2


def screen_has(text: str) -> bool:
    """Whether any node on screen carries `text`, case-insensitively."""
    needle = text.lower()
    for node in dump_tree().iter("node"):
        blob = ((node.get("text") or "") + " " + (node.get("content-desc") or "")).lower()
        if needle in blob:
            return True
    return False


def dismiss_modal():
    """Close an open sheet by its own Close control.

    Back does NOT dismiss these sheets (they close on Save or on Close), and a
    cold relaunch is no help either: force-stopping a development build drops
    you on the dev-client launcher rather than the deep-linked route. So the
    only reliable exit is the button the app itself draws.
    """
    for node in dump_tree().iter("node"):
        if node.get("clickable") == "true" and (node.get("content-desc") or "") == "Close":
            hit = node_center(node)
            if hit:
                adb("shell", "input", "tap", str(hit[0]), str(hit[1]))
                time.sleep(1.0)
                return True
    return False


def tap_target(needle: str):
    """Centre of the clickable node whose label contains `needle`.

    Matched on the accessibility label rather than the visible name: a name
    like "Mira" appears in several places at once (the header, a sheet's "for
    Mira"), and the first match in document order is not necessarily the one
    that does anything useful.
    """
    for node in dump_tree().iter("node"):
        blob = (node.get("content-desc") or "") + " " + (node.get("text") or "")
        if node.get("clickable") == "true" and needle.lower() in blob.lower():
            return node_center(node)
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--theme", default=None, choices=["light", "dark"],
                    help="capture only the shots for this theme; it must match "
                         "the theme the device was last seeded with")
    ap.add_argument("--skip", nargs="*", default=["welcome"],
                    help="ids to leave out (welcome needs its own seed pass)")
    ap.add_argument("--settle", type=float, default=2.5, help="seconds to let a screen settle")
    ap.add_argument("--no-demo-mode", action="store_true")
    args = ap.parse_args()

    if PKG not in adb("shell", "pm", "list", "packages", "budkin"):
        sys.exit(f"{PKG} is not installed.")

    OUT.mkdir(parents=True, exist_ok=True)
    shots = [s for s in SHOTS if not args.only or s["id"] in args.only]
    if args.theme:
        shots = [s for s in shots if s["theme"] == args.theme]
    if not args.only:
        shots = [s for s in shots if s["id"] not in args.skip]
    if not shots:
        sys.exit("nothing to capture with those filters")

    if not args.no_demo_mode:
        demo_mode(True)

    written = 0
    for shot in shots:
        open_route(shot["route"])
        time.sleep(args.settle)

        anchor = shot.get("anchor")
        for attempt in range(4):
            if not anchor or screen_has(anchor):
                break
            # Re-fire rather than just waiting longer: a link dropped during
            # startup never arrives, so more patience alone does not help.
            open_route(shot["route"])
            time.sleep(args.settle + attempt)
        else:
            print(f"{shot['file']}: never showed {anchor!r}, skipped", file=sys.stderr)
            continue

        if shot.get("tap"):
            hit = tap_target(shot["tap"])
            if not hit:
                print(f"{shot['file']}: nothing matching {shot['tap']!r} to tap, skipped",
                      file=sys.stderr)
                continue
            adb("shell", "input", "tap", str(hit[0]), str(hit[1]))
            time.sleep(1.5)

        png = adb("exec-out", "screencap", "-p", binary=True)
        dst = OUT / f"{shot['file']}.png"
        dst.write_bytes(png)
        written += 1
        print(f"{dst.name}  {len(png) / 1024:.0f} KB  {shot['route']}")

        if shot.get("modal") and not dismiss_modal():
            print(f"{shot['file']}: no Close control found; later shots may be "
                  f"taken through this sheet", file=sys.stderr)

    if not args.no_demo_mode:
        demo_mode(False)

    # Counts what actually landed, not what was asked for: a skipped shot
    # leaves the PREVIOUS run's file on disk, and an overstated count is how
    # that stale image gets published.
    print(f"\n{written} of {len(shots)} captured into {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
