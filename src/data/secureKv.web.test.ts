import { afterEach, describe, expect, it } from 'vitest';

import { kvGet, kvRemove, kvSet } from '@/data/secureKv.web';

function fakeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('secureKv.web', () => {
  it('round-trips set / get / remove via localStorage', async () => {
    (globalThis as { localStorage?: unknown }).localStorage = fakeLocalStorage();
    await kvSet('k', 'v');
    expect(await kvGet('k')).toBe('v');
    await kvRemove('k');
    expect(await kvGet('k')).toBeNull();
  });

  it('returns null for a missing key', async () => {
    (globalThis as { localStorage?: unknown }).localStorage = fakeLocalStorage();
    expect(await kvGet('missing')).toBeNull();
  });

  it('no-ops without localStorage (SSR / static render) instead of throwing', async () => {
    await expect(kvSet('k', 'v')).resolves.toBeUndefined();
    expect(await kvGet('k')).toBeNull();
    await expect(kvRemove('k')).resolves.toBeUndefined();
  });
});
