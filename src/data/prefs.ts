/**
 * Persisted on-device app preferences, backed by AsyncStorage.
 *
 * Unlike the connection/token (secureKv), these are non-secret UI choices —
 * today just the theme mode — so a plain AsyncStorage entry is fine (mirrors
 * `src/data/timers.ts`). Kept as a small object so future prefs can join it.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ThemeMode } from '@/theme/tokens';

const KEY = 'babybuddy.prefs.v1';

export interface Prefs {
  themeMode: ThemeMode;
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

export async function savePrefs(prefs: Prefs): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(prefs));
  } catch (e) {
    console.warn('[prefs] savePrefs failed:', e);
  }
}
