/**
 * Persisted medication regimens ("cures"), backed by AsyncStorage.
 *
 * Cures are a purely local concept (an on-device template the user logs a dose
 * from): the Baby Buddy server has no matching record, so nothing here ever
 * uploads. This on-device copy is the only thing that brings a child's cures
 * back after the app is closed and reopened, mirroring src/data/timers.ts. They
 * are user data, so they survive disconnect() (unlike the synced entity store).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Cure } from '@/types/models';

const KEY = 'babybuddy.cures.v1';

export async function loadCures(): Promise<Cure[]> {
  try {
    const s = await AsyncStorage.getItem(KEY);
    if (!s) return [];
    return JSON.parse(s) as Cure[];
  } catch (e) {
    console.warn('[cures] loadCures failed:', e);
    return [];
  }
}

export async function saveCures(cures: Cure[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(cures));
  } catch (e) {
    console.warn('[cures] saveCures failed:', e);
  }
}

export async function clearCures(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
