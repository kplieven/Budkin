/**
 * Native key-value backend for secrets (server token + connection), backed by
 * expo-secure-store (Keychain / Keystore). Metro swaps this for secureKv.web.ts
 * on web, where no secure storage exists. All calls are guarded so an
 * unsupported platform degrades to a no-op rather than crashing.
 */

import * as SecureStore from 'expo-secure-store';

export async function kvGet(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function kvSet(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    /* unsupported platform — skip persistence */
  }
}

export async function kvRemove(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    /* ignore */
  }
}
