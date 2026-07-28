/**
 * Persisted on-device app preferences, backed by AsyncStorage.
 *
 * Unlike the connection/token (secureKv), these are non-secret UI choices —
 * the theme mode and the metric/imperial units lens — so a plain AsyncStorage
 * entry is fine (mirrors `src/data/timers.ts`). Kept as a small object so future
 * prefs can join it.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { UnitSystem } from '@/lib/units';
import type { ThemeMode } from '@/theme/tokens';

const KEY = 'budkin.prefs.v1';

export interface Prefs {
  themeMode: ThemeMode;
  /** Budkin-local metric/imperial display lens (default 'metric'). */
  unitSystem: UnitSystem;
  /** true once first-run setup has been completed. */
  tutorialSeen: boolean;
  /**
   * Bath rhythm: how many SMALL washes fall between two big ones (default 3,
   * range 1..30). Purely local — Baby Buddy has no notion of wash size, so this
   * only drives Budkin's "what's due next" pre-selection.
   */
  smallWashesPerBig: number;
  /**
   * Sleep rhythm: the window in which a sleep counts as a NAP rather than night
   * sleep, as minutes since local midnight (default 420/1140 = 07:00 to 19:00).
   * Start inclusive, end exclusive; a start later than the end wraps midnight.
   *
   * Minutes since midnight rather than a timestamp because this is a wall-clock
   * rule that must mean the same thing on every date and across DST.
   */
  napWindowStartMin: number;
  napWindowEndMin: number;
  /**
   * Insights "Rhythm" graph: the hour of day the 24h window starts at (0..23,
   * default 12 = noon-to-noon). This is the tab's day boundary — it anchors the
   * heatmap AND the per-window trend bucketing so the graph and the numbers
   * agree. A whole hour (not a timestamp) so it means the same on every date.
   */
  rhythmOriginHour: number;
  /**
   * Insights "Rhythm" graph layer toggles: which series the heatmap draws.
   * Remembered so a user who hides, say, diapers keeps them hidden across app
   * restarts. Global (like every other pref); all default to visible.
   */
  rhythmShowSleep: boolean;
  rhythmShowFeeds: boolean;
  rhythmShowDiapers: boolean;
  /**
   * Growth charts: whether the WHO growth-standard percentile curves are drawn
   * behind a metric's own line. Global (like every other pref), default on.
   */
  showGrowthReference: boolean;
}

/** A persisted file may predate a field, so callers get a Partial back. */
export async function loadPrefs(): Promise<Partial<Prefs>> {
  try {
    const s = await AsyncStorage.getItem(KEY);
    if (!s) return {};
    return JSON.parse(s) as Partial<Prefs>;
  } catch (e) {
    console.warn('[prefs] loadPrefs failed:', e);
    return {};
  }
}

/**
 * Persist a partial set of prefs, MERGING into whatever is already stored. Each
 * setter (e.g. `toggleTheme`, `setUnitSystem`) passes only its own field, so a
 * merge is required — a whole-object overwrite would silently clobber the other
 * fields (a plain overwrite worked only while `themeMode` was the sole field).
 */
export async function savePrefs(patch: Partial<Prefs>): Promise<void> {
  try {
    const existing = await loadPrefs();
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...existing, ...patch }));
  } catch (e) {
    console.warn('[prefs] savePrefs failed:', e);
  }
}
