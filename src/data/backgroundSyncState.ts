/**
 * When the background reminder reconcile last completed, epoch ms. Backed by
 * AsyncStorage, mirroring src/data/milestonePrompts.ts. Deliberately NOT in
 * src/data/prefs.ts: that is UI preferences which hydrate() reads into the store,
 * and this is worker bookkeeping no screen ever shows.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'budkin.bgsync.v1';

/** Null means "never synced", which the gate treats as an elapsed floor. */
export async function loadLastBackgroundSyncAt(): Promise<number | null> {
  try {
    const s = await AsyncStorage.getItem(KEY);
    if (s == null) return null;
    const n = Number(s);
    // A corrupt value must read as "never", not as NaN: NaN poisons every
    // comparison in the gate and would silently wedge it closed.
    return Number.isFinite(n) ? n : null;
  } catch (e) {
    console.warn('[backgroundSyncState] loadLastBackgroundSyncAt failed:', e);
    return null;
  }
}

export async function saveLastBackgroundSyncAt(ms: number): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, String(ms));
  } catch (e) {
    console.warn('[backgroundSyncState] saveLastBackgroundSyncAt failed:', e);
  }
}
