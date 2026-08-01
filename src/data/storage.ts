/**
 * Persisted connection (server URL + token, or demo flag). Native: secure-store
 * (Keychain/Keystore); web: localStorage — see secureKv / secureKv.web.
 */

import type { Connection } from '@/data/repository';
import { kvGet, kvRemove, kvSet } from '@/data/secureKv';

const KEY = 'budkin.connection.v1';

export async function saveConnection(c: Connection): Promise<void> {
  await kvSet(KEY, JSON.stringify(c));
}

export async function loadConnection(): Promise<Connection | null> {
  const s = await kvGet(KEY);
  if (!s) return null;
  try {
    const raw = JSON.parse(s) as any;
    // Migrate a legacy `{ demo: boolean; serverUrl; token }` shape (pre-`mode`
    // union) into the current discriminated union, and WRITE the converted
    // shape back. A read-only migration leaves the legacy record in place
    // forever (the web deploy's origin never changed, so a browser that
    // connected before the union still holds it), which is what would keep
    // this branch permanently load-bearing. Awaited so the upgrade lands even
    // if the app dies right after launch; kvSet swallows its own failures, so
    // a failed write simply migrates again next launch. Once every client has
    // loaded a build containing this write, this whole branch can be deleted.
    if (raw && typeof raw === 'object' && 'demo' in raw) {
      const migrated: Connection = raw.demo
        ? { mode: 'local' }
        : { mode: 'server', serverUrl: raw.serverUrl, token: raw.token };
      await saveConnection(migrated);
      return migrated;
    }
    return raw as Connection;
  } catch {
    return null;
  }
}

export async function clearConnection(): Promise<void> {
  await kvRemove(KEY);
}
