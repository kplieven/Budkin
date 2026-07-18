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

const KEY = 'babybuddy.prefs.v1';

export interface Prefs {
  themeMode: ThemeMode;
  /** Budkin-local metric/imperial display lens (default 'metric'). */
  unitSystem: UnitSystem;
  /** true once the first-run walkthrough carousel has been dismissed. */
  tutorialSeen: boolean;
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
