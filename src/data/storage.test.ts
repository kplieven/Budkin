import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearConnection, loadConnection, saveConnection } from '@/data/storage';
import type { Connection } from '@/data/repository';

// In-memory stand-in for the native expo-secure-store module (same pattern as servers.test.ts).
const mem = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (k: string) => mem.store.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => {
    mem.store.set(k, v);
  }),
  deleteItemAsync: vi.fn(async (k: string) => {
    mem.store.delete(k);
  }),
}));

const KEY = 'babybuddy.connection.v1';

beforeEach(() => {
  mem.store.clear();
});

describe('connection persistence', () => {
  it('returns null when nothing is saved', async () => {
    expect(await loadConnection()).toBeNull();
  });

  it('round-trips a local connection', async () => {
    const conn: Connection = { mode: 'local' };
    await saveConnection(conn);
    expect(await loadConnection()).toEqual(conn);
  });

  it('round-trips a server connection', async () => {
    const conn: Connection = { mode: 'server', serverUrl: 'https://x', token: 't' };
    await saveConnection(conn);
    expect(await loadConnection()).toEqual(conn);
  });

  it('clearConnection removes the persisted connection', async () => {
    await saveConnection({ mode: 'local' });
    await clearConnection();
    expect(await loadConnection()).toBeNull();
  });

  it('migrates a legacy demo:true connection to { mode: "local" }', async () => {
    mem.store.set(KEY, JSON.stringify({ demo: true, serverUrl: '', token: '' }));
    expect(await loadConnection()).toEqual({ mode: 'local' });
  });

  it('migrates a legacy demo:false connection to { mode: "server", serverUrl, token }', async () => {
    mem.store.set(KEY, JSON.stringify({ demo: false, serverUrl: 'https://x', token: 't' }));
    expect(await loadConnection()).toEqual({ mode: 'server', serverUrl: 'https://x', token: 't' });
  });

  it('loads a new-shape { mode: "local" } connection unchanged', async () => {
    mem.store.set(KEY, JSON.stringify({ mode: 'local' }));
    expect(await loadConnection()).toEqual({ mode: 'local' });
  });

  it('returns null instead of throwing on corrupt persisted JSON', async () => {
    mem.store.set(KEY, '{not json');
    expect(await loadConnection()).toBeNull();
  });
});
