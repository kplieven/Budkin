/**
 * Persisted connection (server URL + token, or demo flag) via expo-secure-store.
 * All calls are guarded so unsupported platforms (e.g. web) degrade to no-ops
 * rather than crashing.
 */

import * as SecureStore from 'expo-secure-store';

import type { Connection } from '@/data/repository';

const KEY = 'babybuddy.connection.v1';

export async function saveConnection(c: Connection): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(c));
  } catch {
    /* unsupported platform — skip persistence */
  }
}

export async function loadConnection(): Promise<Connection | null> {
  try {
    const s = await SecureStore.getItemAsync(KEY);
    return s ? (JSON.parse(s) as Connection) : null;
  } catch {
    return null;
  }
}

export async function clearConnection(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* ignore */
  }
}
