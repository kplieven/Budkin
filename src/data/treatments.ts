/**
 * Persisted medication regimens ("treatments"), backed by AsyncStorage. In local
 * mode this is the only copy; connected, it is the OFFLINE CACHE in front of the
 * server, which stores each treatment as a `treatment`-tagged note (see
 * `treatmentToNoteBody` in src/api/client.ts) because Baby Buddy has no regimen
 * resource of its own. Treatments are user data, so they survive disconnect(),
 * unlike the synced entity store.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Treatment } from '@/types/models';

const KEY = 'budkin.treatments.v1';

export async function loadTreatments(): Promise<Treatment[]> {
  try {
    const s = await AsyncStorage.getItem(KEY);
    if (!s) return [];
    return JSON.parse(s) as Treatment[];
  } catch (e) {
    console.warn('[treatments] loadTreatments failed:', e);
    return [];
  }
}

export async function saveTreatments(treatments: Treatment[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(treatments));
  } catch (e) {
    console.warn('[treatments] saveTreatments failed:', e);
  }
}

export async function clearTreatments(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
