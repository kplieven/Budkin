/**
 * Web key-value backend (Metro resolves this over secureKv.ts on web). The
 * browser has no secure storage, so this falls back to localStorage — the token
 * is unavoidably plaintext on web. Guarded for static rendering (no localStorage
 * in the Node prerender) so every call degrades to a no-op instead of throwing.
 */

function ls(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export async function kvGet(key: string): Promise<string | null> {
  try {
    return ls()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export async function kvSet(key: string, value: string): Promise<void> {
  try {
    ls()?.setItem(key, value);
  } catch {
    /* quota / unavailable — skip persistence */
  }
}

export async function kvRemove(key: string): Promise<void> {
  try {
    ls()?.removeItem(key);
  } catch {
    /* ignore */
  }
}
