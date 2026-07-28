/**
 * Persisted medication regimens ("cures"), backed by AsyncStorage.
 *
 * This on-device copy is what brings a child's cures back after the app is
 * closed and reopened, mirroring src/data/timers.ts. In local mode it is the
 * only copy; when connected it is the OFFLINE CACHE in front of the server,
 * which stores each cure as a `cure`-tagged note (see `cureToNoteBody` in
 * src/api/client.ts) because Baby Buddy has no regimen resource of its own.
 *
 * Nothing here talks to the network: the store owns the mirror. Cures are user
 * data, so they survive disconnect() (unlike the synced entity store).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Cure } from '@/types/models';

const KEY = 'budkin.cures.v1';

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
