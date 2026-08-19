/** Persisted non-secret UI preferences; the connection and token live in secureKv. */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { UnitSystem } from '@/lib/units';
import type { ThemeMode } from '@/theme/tokens';

const KEY = 'budkin.prefs.v1';

export interface Prefs {
  themeMode: ThemeMode;
  /** Budkin-local display lens, not the server's unit setting (default 'metric'). */
  unitSystem: UnitSystem;
  tutorialSeen: boolean;
  dueDateReminders: boolean;
  staleTimerReminders: boolean;
  ageMilestones: boolean;
  pumpingReminders: boolean;
  pumpingIntervalMin: number;
  /** when the pumping toggle was last switched on, epoch ms */
  pumpingEnabledAt: number | null;
  napSuggestions: boolean;
  treatmentReminders: boolean;
  /** When the treatments toggle was last switched on, epoch ms. Toggling off and on
   *  rebases the reminder phase to now; it can MOVE a grid, never start one. */
  treatmentRemindersEnabledAt: number | null;
  milestoneCatchUp: boolean;
  /** The window in which a sleep counts as a NAP, as minutes since LOCAL midnight
   *  (default 420/1140 = 07:00 to 19:00). Start inclusive, end exclusive; a start
   *  later than the end wraps midnight. Wall-clock, so it holds across DST. */
  napWindowStartMin: number;
  napWindowEndMin: number;
  /** Hour of day the Insights 24h window starts at (0..23, default 12). Anchors the
   *  heatmap AND the per-window trend bucketing, so graph and numbers agree. */
  rhythmOriginHour: number;
  rhythmShowSleep: boolean;
  rhythmShowFeeds: boolean;
  rhythmShowDiapers: boolean;
  showGrowthReference: boolean;
}

/** Fields Budkin no longer writes, kept readable so a stored value can be migrated
 *  forward. Not part of `Prefs`, so nothing can accidentally save one. */
export interface LegacyPrefs {
  /** Pre-2026-08 bath rhythm, read only to seed a child with nothing stored. */
  smallWashesPerBig?: number;
}

/** A persisted file may predate a field, so callers get a Partial back. */
export async function loadPrefs(): Promise<Partial<Prefs> & LegacyPrefs> {
  try {
    const s = await AsyncStorage.getItem(KEY);
    if (!s) return {};
    return JSON.parse(s) as Partial<Prefs> & LegacyPrefs;
  } catch (e) {
    console.warn('[prefs] loadPrefs failed:', e);
    return {};
  }
}

/** Persist a partial set of prefs, MERGING into whatever is already stored: each
 *  setter passes only its own field, so an overwrite would clobber the others. */
export async function savePrefs(patch: Partial<Prefs>): Promise<void> {
  try {
    const existing = await loadPrefs();
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...existing, ...patch }));
  } catch (e) {
    console.warn('[prefs] savePrefs failed:', e);
  }
}
