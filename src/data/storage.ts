/**
 * Persisted connection (server URL + token, or demo flag). Native: secure-store
 * (Keychain/Keystore); web: localStorage — see secureKv / secureKv.web.
 */

import type { Connection } from '@/data/repository';
import { kvGet, kvRemove, kvSet } from '@/data/secureKv';

const KEY = 'babybuddy.connection.v1';

export async function saveConnection(c: Connection): Promise<void> {
  await kvSet(KEY, JSON.stringify(c));
}

export async function loadConnection(): Promise<Connection | null> {
  const s = await kvGet(KEY);
  if (!s) return null;
  try {
    return JSON.parse(s) as Connection;
  } catch {
    return null;
  }
}

export async function clearConnection(): Promise<void> {
  await kvRemove(KEY);
}
