import { afterEach, describe, expect, it, vi } from 'vitest';

import { requestPersistentStorage } from '@/lib/persistentStorage';

/** Installs a fake `navigator.storage`; pass undefined to simulate native / old browsers. */
function stubStorage(storage: unknown): void {
  vi.stubGlobal('navigator', storage === undefined ? {} : { storage });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestPersistentStorage', () => {
  it('returns false when the Storage API is absent (native, old browsers)', async () => {
    stubStorage(undefined);
    expect(await requestPersistentStorage()).toBe(false);
  });

  it('returns false when persist() is missing but persisted() exists', async () => {
    stubStorage({ persisted: async () => false });
    expect(await requestPersistentStorage()).toBe(false);
  });

  it('returns true without re-asking when the origin is already persisted', async () => {
    const persist = vi.fn(async () => true);
    stubStorage({ persisted: async () => true, persist });

    expect(await requestPersistentStorage()).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('asks for persistence and returns true when the browser grants it', async () => {
    const persist = vi.fn(async () => true);
    stubStorage({ persisted: async () => false, persist });

    expect(await requestPersistentStorage()).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('returns false when the browser denies the request', async () => {
    stubStorage({ persisted: async () => false, persist: async () => false });
    expect(await requestPersistentStorage()).toBe(false);
  });

  it('returns false when the Storage API throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubStorage({
      persisted: async () => {
        throw new Error('SecurityError');
      },
      persist: async () => true,
    });
    expect(await requestPersistentStorage()).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
