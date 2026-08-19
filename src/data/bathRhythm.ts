/**
 * Persisted on-device bath rhythm, per child: `{ [childId]: BathRhythm }`.
 * Deliberately NOT part of `Prefs`, whose every entry is global, so it gets its
 * own key rather than making that file carry an exception.
 *
 * Keying by child id is only safe because child ids do not mutate on push. Local
 * only: Baby Buddy has no notion of wash cadence, so nothing here is ever sent.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { BathRhythm } from '@/types/models';

const KEY = 'budkin.bathRhythm.v1';

export async function loadBathRhythms(): Promise<Record<string, BathRhythm>> {
  try {
    const s = await AsyncStorage.getItem(KEY);
    if (!s) return {};
    const parsed = JSON.parse(s) as Record<string, BathRhythm>;
    // Reject anything that is not a plain object (arrays, null, primitives).
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
