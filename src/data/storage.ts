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
    const raw = JSON.parse(s) as any;
    // Migrate a legacy `{ demo: boolean; serverUrl; token }` shape (pre-`mode`
    // union) into the current discriminated union.
    if (raw && typeof raw === 'object' && 'demo' in raw) {
      return raw.demo
        ? { mode: 'local' }
        : { mode: 'server', serverUrl: raw.serverUrl, token: raw.token };
    }
    return raw as Connection;
  } catch {
    return null;
  }
}

export async function clearConnection(): Promise<void> {
  await kvRemove(KEY);
}
