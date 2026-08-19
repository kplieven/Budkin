/**
 * Builds the localStorage payload that puts the web app into Local mode on the
 * demo dataset, for Play Store screenshots. Prints `{ now, storage }` as JSON.
 *
 *   npx vite-node --config scripts/screenshots/vite.config.ts \
 *     scripts/screenshots/buildFixture.ts -- --theme=light
 *
 * Written against the app's own save functions rather than hand-writing the JSON, so
 * month chunking, the migration marker and every value shape come from the code that
 * ships. A hand-written fixture drifts from the models silently, and the only symptom is
 * a screenshot that renders empty.
 *
 * On web, AsyncStorage IS localStorage and secureKv falls back to it too, so one flat
 * map covers both.
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
 * What every relative timestamp in the seed is measured from, and what `capture.mjs`
 * pins the browser clock to. The 11:45 default matters: Insights bins days into
 * noon-to-noon windows, so the window in progress is only as full as the time since
 * yesterday noon. Capturing mid-afternoon left the newest point on every trend chart at
 * a couple of hours against a ~14h average, a cliff that reads as a broken chart.
 */
const at = arg('at', '');
const now = at ? new Date(at).getTime() : new Date(new Date().setHours(11, 45, 0, 0)).getTime();

const seed = makeSeed(now);
const selected = seed.children.find((c) => c.id === seed.selectedChildId)!;
// The WHO percentile bands on a growth chart only draw for a recorded gender.
selected.gender = 'girl';

// Six weeks behind the seed's one rich day, or Insights and the growth chart photograph
// as empty states.
const past = makeHistory(now, selected.id, selected.birth);

await saveChildren(seed.children);
await saveEntries([...past.entries, ...seed.entries]);
// The seed's four measurements are the most recent readings, and the generated series
// supplies everything before them, so a curve has a shape to draw.
await saveMeasurements([...past.measurements, ...seed.measurements]);
await saveSelectedChildId(seed.selectedChildId);
// Keyed per child by the store; the seed carries the one pair for `c1`.
await saveLastFeed({ [seed.selectedChildId]: seed.lastFeed });
await saveTimers(seed.timers);
await saveEntityOrigin('local');

/**
 * Sets `rhythmOriginHour`, for the on-device capture where the clock cannot be faked:
 * choosing the option just AFTER the current time makes the newest point on every trend
 * a nearly complete day instead of a cliff. On web, pinning the clock does this instead.
 */
const dayStart = arg('dayStart', '');

// `--tutorial=false` is the only way to reach /welcome, which redirects straight out
// once the flag is set.
await savePrefs({
  themeMode: theme,
  unitSystem: 'metric',
  tutorialSeen: arg('tutorial', 'true') !== 'false',
  ...(dayStart ? { rhythmOriginHour: Number(dayStart) } : {}),
});

// Written directly rather than through `saveConnection`, whose secureKv import pulls
// in expo-secure-store and cannot load outside a native runtime. The key is the one
// `src/data/storage.ts` reads.
await AsyncStorage.setItem('budkin.connection.v1', JSON.stringify({ mode: 'local' }));

process.stdout.write(JSON.stringify({ now, theme, storage: dump() }, null, 2));
