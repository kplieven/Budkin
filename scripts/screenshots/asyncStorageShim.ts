/**
 * In-memory stand-in for `@react-native-async-storage/async-storage`, aliased over
 * the real module by `vite.config.ts`. It lets `buildFixture.ts` run the app's OWN
 * persistence functions outside a browser and read back exactly the key-value pairs
 * they produced. Only the methods the data layer actually calls are implemented.
 */

const store = new Map<string, string>();

const AsyncStorage = {
  async getItem(key: string): Promise<string | null> {
    return store.get(key) ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    store.set(key, value);
  },
  async removeItem(key: string): Promise<void> {
    store.delete(key);
  },
  async getAllKeys(): Promise<string[]> {
    return [...store.keys()];
  },
  async multiGet(keys: string[]): Promise<[string, string | null][]> {
    return keys.map((k) => [k, store.get(k) ?? null]);
  },
  async multiSet(pairs: [string, string][]): Promise<void> {
    for (const [k, v] of pairs) store.set(k, v);
  },
  async multiRemove(keys: string[]): Promise<void> {
    for (const k of keys) store.delete(k);
  },
  async clear(): Promise<void> {
    store.clear();
  },
};

/** Everything written so far, as the localStorage map the browser should start with. */
export function dump(): Record<string, string> {
  return Object.fromEntries(store);
}

export default AsyncStorage;
