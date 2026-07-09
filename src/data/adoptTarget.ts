/**
 * Persisted adopt target: the server URL of the most recent (possibly still
 * in-progress/partial) `adopt` call in `useAppStore`. Backed by AsyncStorage
 * (not just module memory) so a `partial` adopt's server-switch reset logic
 * survives an app kill — see `adopt` in `useAppStore.ts`.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'babybuddy.adoptTarget.v1';

export async function loadAdoptTarget(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function saveAdoptTarget(url: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, url);
  } catch {
    /* ignore */
  }
}

export async function clearAdoptTarget(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
