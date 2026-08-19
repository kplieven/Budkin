/**
 * Asks the browser to mark this origin's storage as persistent.
 *
 * The web build keeps everything in localStorage (AsyncStorage's web backend), which
 * browsers treat as evictable: under storage pressure, or after a stretch of no
 * visits, the whole origin can be cleared, silently dropping a self-hosted family's
 * entire local-mode history.
 *
 * Feature-detected rather than gated on `Platform.OS`, so it no-ops on native without
 * importing anything platform-specific. Best-effort: a denial is not worth surfacing.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  const storage = globalThis.navigator?.storage;
  if (!storage?.persist || !storage.persisted) return false;

  try {
    // Already granted from a previous visit: don't ask again. Chromium decides
    // silently on engagement heuristics, but Firefox shows a permission prompt, and
    // re-prompting on every cold start would be hostile.
    if (await storage.persisted()) return true;
    return await storage.persist();
  } catch (e) {
    console.warn('[persistentStorage] persistence request failed:', e);
    return false;
  }
}
