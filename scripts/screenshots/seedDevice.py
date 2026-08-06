#!/usr/bin/env python3
"""Seed the demo dataset into a DEV-VARIANT build on a USB-connected phone.

    python3 scripts/screenshots/seedDevice.py [--theme light|dark] [--day-start 19]

Same fixture as the web captures (buildFixture.ts), written into the app's
AsyncStorage database instead of localStorage. Your Baby Buddy server is never
contacted, and neither is your real Budkin install: this only ever touches
`dev.karellievens.budkin.dev`, the development applicationId from app.config.js,
which installs alongside the production app in its own sandbox.

Two things differ from the web path and both are forced by Android:

1. `budkin.connection.v1` lives in expo-secure-store (Keystore-encrypted), not
   in AsyncStorage, so it CANNOT be written from here. Enter Local mode by hand
   first ("Just use this device" on the welcome screen) and let the app write
   its own connection record. This script refuses to run until it sees one.

2. Writing at all needs `run-as`, which only works on a DEBUGGABLE build. That
   is why the capture uses a development build rather than a release APK.

The app must be stopped while its database is swapped, so this stops it, writes,
and leaves it stopped for the caller to relaunch.
"""

import argparse
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PKG = "dev.karellievens.budkin.dev"
DB = "RKStorage"
TABLE = "catalystLocalStorage"
ADB = os.environ.get("ADB", str(Path.home() / "Android/Sdk/platform-tools/adb"))

# Never written from here: Keystore-backed, and forging it is not possible.
SECURE_KEYS = {"budkin.connection.v1"}


def adb(*args, binary=False, check=True):
    cmd = [ADB, *args]
    out = subprocess.run(cmd, capture_output=True, check=False)
    if check and out.returncode != 0:
        sys.exit(f"adb {' '.join(args)} failed:\n{out.stderr.decode(errors='replace')}")
    return out.stdout if binary else out.stdout.decode(errors="replace").strip()


def require_device():
    lines = [l for l in adb("devices").splitlines()[1:] if l.strip()]
    ready = [l.split()[0] for l in lines if l.split()[-1] == "device"]
    if not ready:
        unauth = [l for l in lines if "unauthorized" in l]
        if unauth:
            sys.exit("Phone is connected but unauthorized: accept the USB debugging prompt on it.")
        sys.exit("No device. Plug the phone in, enable USB debugging, and accept the prompt.")
    if len(ready) > 1:
        sys.exit(f"More than one device attached ({', '.join(ready)}); set ANDROID_SERIAL.")
    return ready[0]


def require_dev_build():
    installed = adb("shell", "pm", "list", "packages", "budkin")
    if PKG not in installed:
        sys.exit(
            f"{PKG} is not installed.\n"
            "Install the development variant (it sits alongside your real app):\n"
            "  APP_VARIANT=development npx expo run:android --device\n"
            "A release/preview APK will NOT work here: it is not debuggable, so its\n"
            "data cannot be written, and it would replace your real Budkin."
        )
    probe = subprocess.run([ADB, "shell", "run-as", PKG, "true"], capture_output=True)
    if probe.returncode != 0:
        sys.exit(
            f"run-as {PKG} was refused, so this build is not debuggable.\n"
            "Screenshot seeding needs the development build, not a release APK."
        )


def build_fixture(theme: str, day_start: int | None, tutorial: bool = True) -> dict:
    # Built at the REAL current time, not the web path's fixed 11:45. A browser
    # clock can be pinned with page.clock.install; a phone's cannot without
    # root, so the data is moved to the clock instead of the other way round.
    # Anything else leaves the seed stale by however long ago 11:45 was, and
    # the home screen says "fed 6h53m ago" over a nap that has "just started".
    now_local = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    args = [
        "npx", "vite-node", "--config", "scripts/screenshots/vite.config.ts",
        "scripts/screenshots/buildFixture.ts", "--", f"--theme={theme}",
        f"--at={now_local}",
    ]
    if day_start is not None:
        args.append(f"--dayStart={day_start}")
    if not tutorial:
        args.append("--tutorial=false")
    out = subprocess.run(args, cwd=ROOT, capture_output=True, check=True)
    return json.loads(out.stdout.decode())


def pull_db(dest: Path) -> bool:
    """True if the app already has a database (it does once it has been opened)."""
    raw = subprocess.run(
        [ADB, "exec-out", "run-as", PKG, "cat", f"databases/{DB}"], capture_output=True
    )
    if raw.returncode != 0 or not raw.stdout:
        return False
    dest.write_bytes(raw.stdout)
    return True


def has_connection() -> bool:
    """expo-secure-store keeps its entries in SharedPreferences; the VALUE is
    encrypted but the KEY name is readable, which is all we need to check."""
    prefs = subprocess.run(
        [ADB, "exec-out", f"run-as {PKG} sh -c 'cat shared_prefs/*.xml 2>/dev/null'"],
        capture_output=True,
    ).stdout.decode(errors="replace")
    return "budkin.connection.v1" in prefs


def write_rows(db_path: Path, storage: dict) -> int:
    con = sqlite3.connect(db_path)
    cur = con.cursor()
    cur.execute(f"CREATE TABLE IF NOT EXISTS {TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    rows = [(k, v) for k, v in storage.items() if k not in SECURE_KEYS]
    cur.executemany(f"INSERT OR REPLACE INTO {TABLE} (key, value) VALUES (?, ?)", rows)
    con.commit()
    con.close()
    return len(rows)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--theme", default="light", choices=["light", "dark"])
    ap.add_argument(
        "--day-start", type=int, default=None,
        help="app 'Day starts at' hour (19, 12, 7 or 0). Pick the option just AFTER "
             "the current time so the newest point on every Insights trend is a "
             "nearly complete window rather than a cliff.",
    )
    ap.add_argument(
        "--no-tutorial", action="store_true",
        help="leave first-run setup unseen, the only way /welcome renders "
             "instead of redirecting past itself",
    )
    args = ap.parse_args()

    serial = require_device()
    print(f"device {serial}")
    require_dev_build()

    if not has_connection():
        sys.exit(
            "The app has no connection record yet, so it is still on first run.\n"
            "On the phone: open Budkin (dev), tap 'Just use this device', add a baby,\n"
            "then run this again. The connection is Keystore-encrypted and cannot be\n"
            "written from here, which is why this one step is by hand."
        )

    fixture = build_fixture(args.theme, args.day_start, tutorial=not args.no_tutorial)
    print(f"fixture built at {fixture['now']} ({args.theme})")

    adb("shell", "am", "force-stop", PKG)

    tmp = Path(tempfile.mkdtemp())
    local = tmp / DB
    if not pull_db(local):
        sys.exit(f"could not read databases/{DB}; open the app once so it is created.")

    written = write_rows(local, fixture["storage"])
    print(f"{written} keys written into {DB}")

    adb("push", str(local), f"/data/local/tmp/{DB}")
    # One pre-quoted string per remote command. `adb shell` joins argv with
    # spaces before handing it to the device shell, so a `sh -c "a b"` written
    # as separate arguments arrives unquoted and the device sees `sh -c a b`,
    # which silently runs `a` with no operands.
    adb("shell", f"run-as {PKG} cp /data/local/tmp/{DB} databases/{DB}")
    # A surviving write-ahead log would replay the OLD contents over the copy.
    adb("shell", f"run-as {PKG} rm -f databases/{DB}-wal databases/{DB}-shm")
    adb("shell", "rm", "-f", f"/data/local/tmp/{DB}")
    shutil.rmtree(tmp, ignore_errors=True)

    print("seeded. Relaunch the app to see it:")
    print(f"  {ADB} shell monkey -p {PKG} -c android.intent.category.LAUNCHER 1")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
