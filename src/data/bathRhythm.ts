/**
 * Persisted on-device bath rhythm, per child. Backed by AsyncStorage, mirroring
 * src/data/milestonePrompts.ts and src/data/prefs.ts.
 *
 * Deliberately NOT part of `Prefs`: every pref in src/data/prefs.ts is global,
 * and this one is per child, so it gets its own key rather than making that file
 * carry an exception. Shape: { [childId]: BathRhythm }.
 *
 * Keying by child id is only safe because child ids stopped mutating on push.
 * Under the older model this map would have been orphaned the first time a child
 * synced to the server.
 *
 * Local only. Baby Buddy has no notion of wash cadence, so nothing here is ever
 * sent to a server.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { BathRhythm } from '@/types/models';

const KEY = 'budkin.bathRhythm.v1';

export async function loadBathRhythms(): Promise<Record<string, BathRhythm>> {
  try {
    const s = await AsyncStorage.getItem(KEY);
    if (!s) return {};
    const parsed = JSON.parse(s) as Record<string, BathRhythm>;
    // Reject anything that is not a plain object (includes arrays, null, primitives).
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    console.warn('[bathRhythm] loadBathRhythms failed:', e);
    return {};
  }
}

export async function saveBathRhythms(map: Record<string, BathRhythm>): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(map));
  } catch (e) {
    console.warn('[bathRhythm] saveBathRhythms failed:', e);
  }
}
