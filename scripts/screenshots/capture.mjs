/**
 * Captures the Play Store screenshot set from the Expo web target, with the app
 * in Local mode on the demo dataset (see buildFixture.ts). Never contacts a
 * Baby Buddy server.
 *
 * Prerequisite, in another terminal:
 *   CI=1 BROWSER=none npx expo start --web --port 8081
 *
 * Then:
 *   node scripts/screenshots/capture.mjs            # all shots
 *   node scripts/screenshots/capture.mjs home log   # only those ids
 *
 * Output is 1080x1920 RGBA PNGs in assets/store/screenshots/raw/. Play rejects
 * alpha, so flatten.py turns them into the uploadable 24-bit files.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(ROOT, 'assets/store/screenshots/raw');
const BASE = process.env.BUDKIN_WEB ?? 'http://localhost:8081';

/**
 * Play wants each side between 320 and 3840 px AND the long side no more than
 * twice the short one, so a real phone's 1080x2400 (2.22:1) is rejected.
 * 1080x1920 is the recommended portrait size and sits exactly on the 2:1 limit.
 */
/**
 * CSS viewport, 9:16 so the scale factor lands the output on 1080x1920 exactly.
 *
 * 360x640 at scale 3 is 100% zoom in the only sense that matters here: one CSS
 * pixel is one dp, which is exactly what a 1080x1920 Android phone renders, so
 * every screen is the size a real user sees it. The cost, and it is a real one,
 * is that the home screen's log grid shows four of its eight tiles, because
 * four is what fits on a phone. Zooming out to fit all eight is what
 * SHOT_W/SHOT_H are for (576x1024 was the previous setting).
 */
const VIEWPORT = { width: Number(process.env.SHOT_W ?? 360), height: Number(process.env.SHOT_H ?? 640) };
const SCALE = 1080 / VIEWPORT.width;

/**
 * `anchor` is text that proves the screen actually rendered before the shot.
 * `reveal` scrolls that text into view first, for screens whose interesting
 * part is below the fold.
 */
const SHOTS = [
  { id: 'home', file: '01-home', route: '/', theme: 'light', anchor: 'Log activity' },
  { id: 'log', file: '02-log-feeding', route: '/log/feeding', theme: 'light', anchor: 'Log feeding' },
  { id: 'history', file: '03-history', route: '/history', theme: 'dark', anchor: 'History' },
  // The chart route, not the Growth tab: the tab is a 2x2 card grid over a lot
  // of empty space, while this draws the curve against the WHO percentile bands.
  { id: 'growth', file: '04-growth', route: '/metric/weight', theme: 'light', anchor: 'WHO reference' },
  { id: 'insights', file: '05-insights', route: '/insights', theme: 'light', anchor: 'Insights' },
  { id: 'milestones', file: '06-milestones', route: '/milestones', theme: 'light', anchor: 'reached' },
  // Opens the child sheet over a dimmed Home: two children, and the switch.
  { id: 'children', file: '07-children', route: '/', theme: 'light', anchor: 'Log activity', click: 'Mira Okafor' },
  // First-run fork. It states the local-mode promise in the app's own words
  // ("Just use this device"), which Settings only implies from a status row.
  { id: 'welcome', file: '08-local-mode', route: '/welcome', theme: 'light', anchor: 'Baby Buddy server', tutorial: false },
  // Captured but not in the numbered set: alternates to swap in.
  { id: 'notes', file: 'alt-notes', route: '/notes', theme: 'light', anchor: 'Notes' },
  { id: 'settings', file: 'alt-settings', route: '/settings', theme: 'light', anchor: 'Settings', reveal: 'Local mode' },
  { id: 'tour', file: 'alt-tour', route: '/tour', theme: 'light', anchor: '' },
  { id: 'timers', file: 'alt-timers', route: '/timers', theme: 'light', anchor: '' },
];

function buildFixture(theme, tutorial = true) {
  const out = execFileSync(
    'npx',
    ['vite-node', '--config', 'scripts/screenshots/vite.config.ts', 'scripts/screenshots/buildFixture.ts', '--', `--theme=${theme}`, `--tutorial=${tutorial}`],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  return JSON.parse(out);
}

const only = process.argv.slice(2);
const wanted = only.length ? SHOTS.filter((s) => only.includes(s.id)) : SHOTS;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox'] });

// One browser context per distinct fixture: the theme lives in the seeded
// prefs, and so does `tutorialSeen`, which decides whether /welcome renders at
// all rather than redirecting past itself.
const variants = [...new Set(wanted.map((s) => `${s.theme}|${s.tutorial !== false}`))];

for (const variant of variants) {
  const [theme, tutorialFlag] = variant.split('|');
  const tutorial = tutorialFlag === 'true';
  const shots = wanted.filter((s) => s.theme === theme && (s.tutorial !== false) === tutorial);
  if (!shots.length) continue;

  const fixture = buildFixture(theme, tutorial);
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    colorScheme: theme,
    // A stable locale keeps dates and numbers identical between runs.
    locale: 'en-GB',
    timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  // Before any app code runs, so hydration already sees a populated store.
  await context.addInitScript((storage) => {
    for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
  }, fixture.storage);

  for (const shot of shots) {
    const page = await context.newPage();
    // Pinned to the instant the fixture was built at, then resumed so timers
    // still tick: the seed's timestamps are relative to it, and a running nap
    // timer would otherwise read a different elapsed value in every shot.
    await page.clock.install({ time: new Date(fixture.now) });
    await page.clock.resume();

    await page.goto(BASE + shot.route, { waitUntil: 'networkidle' });
    // The RN-web dev warning toast overlays the bottom of the screen.
    await page.addStyleTag({ content: '#error-toast{display:none!important;pointer-events:none!important}' });

    if (shot.anchor) {
      await page.getByText(shot.anchor, { exact: false }).first().waitFor({ timeout: 20000 });
    }
    if (shot.click) {
      await page.getByText(shot.click, { exact: false }).first().click();
      await page.waitForTimeout(700);
    }
    if (shot.reveal) {
      // Centred, not scrollIntoViewIfNeeded: that stops as soon as the element
      // is barely on screen, which parks it against the bottom edge.
      await page.getByText(shot.reveal, { exact: false }).first()
        .evaluate((el) => el.scrollIntoView({ block: 'center' }));
    }
    await page.evaluate(() => document.fonts.ready);
    // Entry animations and chart draws settle well inside this.
    await page.waitForTimeout(1200);

    const file = path.join(OUT, `${shot.file}.png`);
    await page.screenshot({ path: file });
    console.log(`${shot.file}.png  ${shot.route}  ${theme}`);
    await page.close();
  }
  await context.close();
}

await browser.close();
