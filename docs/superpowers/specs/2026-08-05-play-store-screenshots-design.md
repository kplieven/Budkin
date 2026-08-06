# Play Store screenshots from seeded fake data

Written 2026-08-05, against `main` at a859ea4.

Eight phone screenshots for the Play listing, captured from the Expo **web**
target driven by Playwright, with the app in **Local mode** on a fake dataset.
The real Baby Buddy server is never contacted and never modified.

## Why this shape

`src/data/seed.ts` already holds a complete fake dataset (Mira and Theo Okafor,
86 days old: feeds, naps, diapers, pumping, baths, temperatures, medications,
notes, growth measurements, and one running sleep timer), all timestamped
relative to a `now` argument. Nothing calls `makeSeed` anymore, so it is dead
code with exactly the right content for this job.

On web every `budkin.*` key is plain `localStorage`: AsyncStorage's web backend
is unprefixed `window.localStorage`, and `secureKv.web.ts` falls back to the
same store for the connection. So the whole app state can be written before
first paint, and the screenshots need no clicking through setup.

The alternative capture surfaces (a real device or an emulator over `adb`) give
more authentic Android rendering. They were considered and set aside for the
scriptability of the web target. The trade is recorded here rather than hidden:
these are RN-web renders, so the capture set deliberately sticks to list, chart
and sheet screens that render the same on both, and the Android home-screen
widget cannot be captured at all.

## Play's asset rules, verified 2026-08-05

From the Play Console help page, not from memory:

- **Max side no more than twice the min side.** A 1080x2400 phone-shaped capture
  is 2.22:1 and is rejected. The target is **1080x1920** exactly.
- JPEG or **24-bit PNG with no alpha**. Playwright writes RGBA PNGs, so
  flattening is mandatory, not cosmetic.
- Minimum 2 to publish, maximum 8. At least 4 at 1080px or better is what makes
  the listing eligible for promotional surfaces, so all 8 are captured.
- Feature graphic is 1024x500, same format rules. Out of scope here.

## Components

Four units, each independently runnable.

### 1. `scripts/screenshots/asyncStorageShim.ts`

An in-memory `AsyncStorage` implementing only what the data layer calls
(`getItem`, `setItem`, `removeItem`, `multiGet`, `multiSet`, `multiRemove`,
`getAllKeys`), plus a `dump()` returning the raw key-value map. No React Native,
no browser.

### 2. `scripts/screenshots/buildFixture.ts`

Run by `vite-node` with a config that aliases `@` to `src/` and
`@react-native-async-storage/async-storage` to the shim. It calls `makeSeed(now)`
and then the app's **own** persistence functions:

| Function | Key(s) written |
| --- | --- |
| `saveChildren` | `budkin.children.v1` |
| `saveEntries` | `budkin.entries.v2.<YYYY-MM>` chunks |
| `saveMeasurements` | `budkin.measurements.v1` |
| `saveSelectedChildId` | `budkin.selectedChild.v1` |
| `saveLastFeed` | `budkin.lastFeed.v1` |
| `saveEntityOrigin('local')` | `budkin.entityOrigin.v1` |
| `saveTimers` | `budkin.timers.v1` |
| `savePrefs` | `budkin.prefs.v1` |
| `saveConnection({mode:'local'})` | `budkin.connection.v1` |

Then it prints `dump()` as JSON. Using the real writers is the point: month
chunking, the migration marker, the `Record<childId, LastFeed>` reshaping and
every value shape come from the code that ships, so the fixture cannot drift
from the models the way a hand-written copy would.

No `budkin.entriesMigrated.v2` marker is written, and none is needed: with no
legacy v1 blob on disk the migration returns early and the chunks load directly
(`migrateEntriesV1`). The marker only matters when a v1 blob exists.

`tutorialSeen: true` goes into prefs or the app opens the first-run wizard.
`selectedChild.v1` is easy to forget and its absence is not obvious: the app
boots child-less, the avatar shows "?" and every per-child screen reads empty,
which looks like total failure rather than one missing key.

### 3. `scripts/screenshots/history.ts`

Six weeks of generated logging behind the seed's single day: nightly sleep,
three naps, roughly three-hourly feeds, diapers, pumping, tummy time, baths,
occasional temperatures, four reached milestones and a handful of notes, plus a
weekly growth series from birth. Deterministic (fixed-seed PRNG), screenshot
tooling only.

This was not in the original plan and the first capture round is why it exists.
Against the bare seed, Insights showed "log about a week of sleep to see the
rhythm heatmap", both trend charts showed "will appear after a few days of
logging", Growth was four cards over a screen of blank cream, Milestones read
"0 of 27 reached" and Notes held two entries. Those are honest empty states and
exactly the wrong thing to put in a store listing.

Today is generated too, up to four hours before `now`. Leaving today empty made
the newest point on every trend chart collapse toward zero, which reads as a
broken chart; the four-hour margin keeps the seed's own afternoon entries the
most recent, so the home screen still says what it was written to say.

### 4. `scripts/screenshots/capture.mjs`

Playwright against a running `CI=1 BROWSER=none npx expo start --web`.

- Viewport 360x640 CSS with the scale factor derived from it (1080/360 = 3), so
  each PNG is 1080x1920. That is 100% zoom in the sense that matters: one CSS
  pixel is one dp, exactly what a 1080x1920 Android phone renders, so every
  screen is the size a real user sees it and the type is legible in the gallery.
  The cost is that the home screen's log grid shows four of its eight tiles,
  because four is what fits on a phone. `SHOT_W` / `SHOT_H` override the
  viewport for a zoomed-out set (576x1024 fits all eight tiles); anything passed
  must stay 9:16 or the output stops being 1080x1920.
- `chromium.launch({ args: ['--no-sandbox'] })`, since the SUID sandbox is not
  configured on this machine.
- `addInitScript` writes the fixture into `localStorage` before any app code
  runs, so hydration sees a populated store on the first pass.
- `page.clock.install({ time })` pins the browser to the same instant the
  fixture was built at, then `resume()` lets it tick. Without this the seed's
  relative timestamps drift against the real clock, and the running nap timer
  reads a different elapsed value in every shot.
- That instant is **today at 11:45**, and the hour is load-bearing. Insights
  bins days noon-to-noon (`noonWindowStart`), so the window in progress is only
  as full as the time since yesterday noon. Capturing mid-afternoon left every
  trend chart ending on a cliff: 18 minutes of sleep against a ~14h average.
  Just before noon the current window is nearly 24 hours old, night included,
  so the line ends level and reads "in typical range".
- `#error-toast` (the benign RN-web dev warning overlay) is hidden with an
  injected style rule, since it sits over the bottom of the screen.
- Each capture waits on `document.fonts.ready` plus a text anchor specific to
  that screen, never on a fixed sleep.

Theme comes from the fixture, so the dark shot is a second run of the same
script with `themeMode: 'dark'` and a one-route capture list.

### 5. `scripts/screenshots/finalize.py`

PIL flattens each capture onto the theme background (`#F6EDE3` light, `#16110E`
dark), saves 24-bit PNG into the delivery directory, and then CHECKS every file
against Play's rules: dimensions in range, long side no more than twice the
short, no alpha, under 8MB. Chromium happens to emit opaque RGB already, but
that is not something to upload on faith, so the check runs regardless and the
script exits non-zero if any file would be rejected.

## Capture list

| # | Screen | Route | Theme | Why it earns a slot |
| --- | --- | --- | --- | --- |
| 1 | Home dashboard | `/` | light | Hero: running nap timer plus the log grid |
| 2 | Log sheet, feeding | `/log/feeding` | light | Backs the "two taps" claim |
| 3 | History | `/history` | dark | The day's timeline, and the dark-mode proof |
| 4 | Weight chart | `/metric/weight` | light | The WHO percentile curve, not the Growth tab's card grid over blank space |
| 5 | Insights | `/insights` | light | Patterns over the seeded history |
| 6 | Milestones | `/milestones` | light | Differentiator against a plain logger |
| 7 | Child switcher | `/` + tap the name | light | Two children, and the one-tap switch between them |
| 8 | Local mode | `/welcome` | light | The app's own words for "no account needed" |

Route groups (`(tabs)`, `(home)`) do not appear in web URLs.

Notes, Settings, the walkthrough and the timer screen are captured as `alt-*`
and left out of the numbered set, ready to swap in.

Slots 7 and 8 were Notes and Settings until the first framed round. Settings
proves local mode with a status row, but the screen is dense configuration text
that opens mid-control, and it is pinned to its scroll end so the framing cannot
improve. `/welcome` states the same thing in the app's own words, with a "Just
use this device" button. Its empty middle, the one real objection to it, mostly
closed when the captures moved back to 100% zoom.

Reaching `/welcome` at all needs `tutorialSeen: false`, since it redirects out
once first-run setup is done, so `buildFixture.ts` takes `--tutorial=false` and
`capture.mjs` builds one browser context per distinct fixture rather than per
theme.

The dev server must run with `BUDKIN_VERSION` set (`BUDKIN_VERSION=0.15.4 CI=1
BROWSER=none npx expo start --web`). Settings prints the build version at the
foot of the page, and `git describe` on a dirty tree renders it as
`0.15.4-dirty`, which is not a string to publish.

### 6. `scripts/screenshots/frames.py`

The listing slides: each capture on a branded background under a headline and a
one-line subhead, still 1080x1920 and still alpha-free, so they upload exactly
like the plain captures.

Type is the app's bundled Figtree (ExtraBold headline, Medium subhead, read
straight out of `node_modules`), and the colours are the theme tokens, so the
gallery, the app and the landing page read as one product. The headline
auto-fits: it steps down from 62px until it fits two lines.

The slide background is deliberately NOT the app's `bg`. A capture on its own
background dissolves into the slide, leaving the rounded frame visible only
where the shadow falls, so light slides sit on the theme's `chip` (`#F1E6D8`)
and dark slides on `#0D0A08`.

Captions state only what the frame beneath them shows. Play rejects listing
images whose claims the app does not back, and "27 milestones", "WHO curves"
and "no account, no server" are each visible in their own screenshot.

## On-device capture (the set that ships)

The web path above was built first and still works; the listing set is now
captured from the app running on a real phone (Galaxy S24, 1080x2340). Two new
scripts, same fixture, same framing.

`seedDevice.py` writes the fixture into the app's AsyncStorage database via
`run-as`, `captureDevice.py` drives the screens over adb, and `frames.py --src
assets/store/screenshots/device --crop-top 100` composes the slides.

It only ever touches **`dev.karellievens.budkin.dev`**, the development
applicationId from `app.config.js`, which installs alongside the production app
in its own sandbox. The Baby Buddy server is never contacted.

What the device forces that the browser did not:

- **The build must be a DEVELOPMENT one.** `run-as` works only on a debuggable
  build, so a release/preview APK cannot be seeded. A preview APK would also
  carry the production package name and replace the real app.
- **`npm run prebuild:dev` first, always.** `expo run:android` reuses an
  existing `android/` and does NOT re-run prebuild, so `APP_VARIANT=development`
  silently fails to reach gradle and the APK comes out with the PRODUCTION
  applicationId. That happened here, and only Android's signature check stopped
  it from replacing the real install.
- **The connection record cannot be forged.** It lives in expo-secure-store
  (Keystore), so Local mode has to be entered by hand once ("Just use this
  device"); `seedDevice.py` refuses to run until it sees one.
- **The clock cannot be pinned** without root, so the fixture is built at the
  real current time and `--day-start` sets the app's own "Day starts at" to the
  option just AFTER now (19:00 for an afternoon capture). Same purpose the 11:45
  browser clock serves on web: a window in progress that is nearly complete.
- **A cold launch lands on the dev-client launcher**, not the deep-linked route,
  so the app is relaunched through `exp+babybuddy-mobile://expo-development-client/?url=...`
  and then navigated. `adb reverse tcp:8081` carries Metro over the USB cable.
- **Sheets are modal and Back does not close them.** A deep link navigates the
  screen UNDERNEATH an open sheet, so without dismissing it every later capture
  is taken through it. They close via their own `Close` control, found in a
  uiautomator dump.
- **Deep links can be swallowed during startup**, which silently leaves the
  previous screen in frame. Every navigation waits for an anchor and re-fires up
  to four times before giving up and SKIPPING the shot rather than saving a
  wrong one.
- **`/timers` is a web URL, not a native deep link.** It is reached by tapping
  "Timers" on Home, the same way the child switcher is reached from the header.
- **Turn off the dev-client "Tools button"** (dev menu, opened with
  `adb shell input keyevent 82`) or its floating bubble sits over the top-right
  of every screenshot.
- **One UI ignores AOSP status-bar demo mode**, so the clock, carrier and
  charging battery cannot be cleaned up. `--crop-top 100` removes the status bar
  instead, which also matches the web slides, where there was none.

## Output

- `assets/store/screenshots/NN-name.png`: plain captures, numbered in listing
  order, plus `alt-*` alternates.
- `assets/store/screenshots/slides/`: the captioned slides, and what actually
  goes to the console.

Pass 2 reads the finalized captures rather than re-driving the browser, so
recomposing a caption is instant and re-running the capture never invalidates
the framing work.

## Failure modes to expect

- **Stale bundle.** `CI=1` caches the web bundle, and Metro's on-disk cache can
  survive a restart. After any source edit, relaunch with `--clear`.
- **`expo-image-picker` uninstalled.** A declared dependency that can be missing
  from a checkout; `expo start` then aborts on the config plugin. Fix with
  `npm install`.
- **A screen renders empty.** Check `budkin.selectedChild.v1` first.
- **Growth cards do not navigate.** A metric card only opens its chart when that
  kind has points; otherwise it opens the measurement sheet.

## Out of scope

Feature graphic, store descriptions, and any capture of the Android widget.
