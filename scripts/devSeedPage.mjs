/**
 * Generates `public/__seed.html`, a dev-only page the Expo web server serves at
 * http://localhost:8081/__seed.html.
 *
 * The demo dataset lives in localStorage, which only a page on the app's own
 * origin can write — hence a served page rather than a script. Clicking a button
 * on it seeds the browser and opens the app in Local mode; no Baby Buddy server
 * is contacted.
 *
 * Timestamps in the fixture are absolute, anchored to generation time, so the
 * data ages: run this again (the budkin-seed.timer unit does it daily) to keep
 * "Today" populated.
 *
 *   node scripts/devSeedPage.mjs
 *
 * The output is gitignored — it is a 250 KB generated artifact, not source.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = process.env.SEED_AT || new Date().toISOString();

/** Built through buildFixture.ts so the payload comes from the app's own save
 *  functions, and cannot drift from the models the way a hand-written one does. */
function fixture(theme) {
  return JSON.parse(execFileSync(
    'npx',
    ['vite-node', '--config', 'scripts/screenshots/vite.config.ts', 'scripts/screenshots/buildFixture.ts',
     '--', `--theme=${theme}`, '--tutorial=true', `--at=${at}`],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  ));
}

const light = fixture('light');
const dark = fixture('dark');
const built = new Date(light.now);

const html = `<!doctype html>
<meta charset="utf-8">
<title>Budkin — seed demo data</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.55 system-ui, sans-serif; max-width: 34rem; margin: 3rem auto; padding: 0 1.25rem; }
  h1 { font-size: 1.35rem; margin: 0 0 .25rem; }
  p { color: #666; } @media (prefers-color-scheme: dark) { p { color: #999; } }
  .row { display: flex; gap: .6rem; flex-wrap: wrap; margin: 1.5rem 0; }
  button { font: inherit; font-weight: 600; padding: .6rem 1rem; border-radius: .6rem;
           border: 1px solid #8884; cursor: pointer; background: #f0b90022; }
  button.ghost { background: transparent; }
  code { background: #8882; padding: .1rem .35rem; border-radius: .3rem; }
  #msg { margin-top: 1rem; font-weight: 600; }
</style>
<h1>Budkin demo data</h1>
<p>Seeds this browser's local storage with the demo family (Mira &amp; Theo), about six
weeks of sleep/feed/diaper history and a weekly weight series, then opens the app in
Local mode. No Baby Buddy server is contacted.</p>
<p>Fixture anchored to <strong>${built.toLocaleString()}</strong>. Regenerated daily by
<code>budkin-seed.timer</code>; re-seed here after it refreshes to pick up the newer data.</p>
<div class="row">
  <button onclick="seed('light')">Seed &amp; open (light)</button>
  <button onclick="seed('dark')">Seed &amp; open (dark)</button>
  <button class="ghost" onclick="wipe()">Clear all local data</button>
</div>
<p>App lives at <code>/</code> once seeded. Re-visit this page any time to reset.</p>
<div id="msg"></div>
<script>
const FIXTURES = ${JSON.stringify({ light: light.storage, dark: dark.storage })};
function seed(theme) {
  localStorage.clear();
  for (const [k, v] of Object.entries(FIXTURES[theme])) localStorage.setItem(k, v);
  document.getElementById('msg').textContent = 'Seeded (' + theme + '). Opening…';
  location.href = '/';
}
function wipe() {
  localStorage.clear();
  document.getElementById('msg').textContent = 'Cleared. The app will start at onboarding.';
}
</script>
`;

mkdirSync(path.join(ROOT, 'public'), { recursive: true });
const out = path.join(ROOT, 'public', '__seed.html');
writeFileSync(out, html);
console.log(`wrote ${path.relative(ROOT, out)} (${(html.length / 1024).toFixed(0)} KB), anchored ${built.toISOString()}`);
