/**
 * Asks the browser to mark this origin's storage as persistent.
 *
 * The web build keeps everything in localStorage (AsyncStorage's web backend),
 * which browsers treat as evictable: under storage pressure, or after a stretch
 * of no visits, the whole origin can be cleared. For the self-hosted docker
 * deployment that would silently drop a family's entire local-mode history.
 * `navigator.storage.persist()` opts the origin out of that eviction.
 *
 * Feature-detected rather than gated on `Platform.OS`: React Native has no
 * `navigator.storage`, so this no-ops on native without importing anything
 * platform-specific. Best-effort by design — browsers may grant, deny, or
 * silently prompt, and a denial is not an error worth surfacing to the user.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  const storage = globalThis.navigator?.storage;
  if (!storage?.persist || !storage.persisted) return false;

  try {
    // Already granted from a previous visit: don't ask again. Chromium decides
    // silently on engagement heuristics, but Firefox shows a permission prompt,
    // and re-prompting on every cold start would be hostile.
    if (await storage.persisted()) return true;
    return await storage.persist();
  } catch (e) {
    console.warn('[persistentStorage] persistence request failed:', e);
    return false;
  }
}
