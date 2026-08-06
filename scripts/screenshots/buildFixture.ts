/**
 * Builds the localStorage payload that puts the web app into Local mode on the
 * demo dataset, for Play Store screenshots. Prints `{ now, storage }` as JSON.
 *
 *   npx vite-node --config scripts/screenshots/vite.config.ts \
 *     scripts/screenshots/buildFixture.ts -- --theme=light
 *
 * The point of doing this in TypeScript, against the app's own save functions,
 * rather than hand-writing the JSON: month chunking, the migration marker, the
 * per-child `lastFeed` reshaping and every value shape then come from the code
 * that ships. A hand-written fixture drifts from the models silently and the
 * only symptom is a screenshot that renders empty.
 *
 * On web, AsyncStorage IS localStorage (unprefixed) and secureKv falls back to
 * it too, so one flat map covers both.
 */

import { saveChildren, saveEntityOrigin, saveEntries, saveLastFeed, saveMeasurements, saveSelectedChildId } from '@/data/entityStore';
import { savePrefs } from '@/data/prefs';
import { makeSeed } from '@/data/seed';
import { saveTimers } from '@/data/timers';
import type { ThemeMode } from '@/theme/tokens';

import AsyncStorage, { dump } from './asyncStorageShim';
import { makeHistory } from './history';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const theme = arg('theme', 'light') as ThemeMode;

/**
 * The instant every relative timestamp in the seed is measured from, and the
 * instant `capture.mjs` pins the browser clock to. Defaults to today at 11:45
 * local, and the exact hour matters more than it looks.
 *
 * Insights bins days into noon-to-noon windows (`noonWindowStart` in
 * src/features/insights/compute.ts), so the window in progress is only as full
 * as the time since yesterday noon. Capturing mid-afternoon left the newest
 * point on every trend chart at a couple of hours against a ~14h average: a
 * cliff that reads as a broken chart. Just before noon the current window is
 * nearly 24 hours old, a whole night included, so the line ends level.
 */
const at = arg('at', '');
const now = at ? new Date(at).getTime() : new Date(new Date().setHours(11, 45, 0, 0)).getTime();

const seed = makeSeed(now);
const selected = seed.children.find((c) => c.id === seed.selectedChildId)!;
// The WHO percentile bands on a growth chart only draw for a recorded gender.
selected.gender = 'girl';

// Six weeks behind the seed's one rich day, or Insights and the growth chart
// photograph as empty states. See history.ts.
const past = makeHistory(now, selected.id, selected.birth);

await saveChildren(seed.children);
await saveEntries([...past.entries, ...seed.entries]);
// The seed's four measurements are the most recent readings; the generated
// series supplies everything before them, so a curve has a shape to draw.
await saveMeasurements([...past.measurements, ...seed.measurements]);
await saveSelectedChildId(seed.selectedChildId);
// The store keys this per child; the seed carries the one pair for `c1`.
await saveLastFeed({ [seed.selectedChildId]: seed.lastFeed });
await saveTimers(seed.timers);
// Labels the stored entities as local-mode data (see `loadEntityOrigin`).
await saveEntityOrigin('local');
// `--tutorial=false` leaves first-run setup unseen, which is the only way to
// reach /welcome: it redirects straight out once the flag is set.
/**
 * `--dayStart=<hour>` sets the app's own "Day starts at" preference (Settings >
 * Rhythm; `rhythmOriginHour`, one of 19/12/7/0). It exists for the on-device
 * capture, where the clock cannot be faked: Insights measures the window in
 * progress from that hour, so choosing the option just AFTER the current time
 * makes the newest point on every trend a nearly complete day instead of a
 * cliff. On web the same problem is solved by pinning the clock to 11:45.
 */
const dayStart = arg('dayStart', '');

await savePrefs({
  themeMode: theme,
  unitSystem: 'metric',
  tutorialSeen: arg('tutorial', 'true') !== 'false',
  ...(dayStart ? { rhythmOriginHour: Number(dayStart) } : {}),
});

// Written directly rather than through `saveConnection`, whose secureKv import
// pulls in expo-secure-store and cannot load outside a native runtime. The key
// is the one `src/data/storage.ts` reads, and on web it lands in the same
// localStorage as everything above.
await AsyncStorage.setItem('budkin.connection.v1', JSON.stringify({ mode: 'local' }));

process.stdout.write(JSON.stringify({ now, theme, storage: dump() }, null, 2));
