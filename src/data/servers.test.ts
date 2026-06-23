import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadServers,
  persistServers,
  removeServer,
  upsertServer,
  type SavedServer,
} from '@/data/servers';

// In-memory stand-in for the native expo-secure-store module.
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

const srv = (serverUrl: string, token = 'tok-' + serverUrl, lastUsedAt = 1): SavedServer => ({
  serverUrl,
  token,
  lastUsedAt,
});

beforeEach(() => {
  mem.store.clear();
});

describe('upsertServer', () => {
  it('adds a new server to the front', () => {
    const list = upsertServer([srv('https://a.lan')], srv('https://b.lan'));
    expect(list.map((s) => s.serverUrl)).toEqual(['https://b.lan', 'https://a.lan']);
  });

  it('dedupes by normalized URL (scheme/trailing slash collapse)', () => {
    const list = upsertServer([srv('https://a.lan')], srv('a.lan/'));
    expect(list).toHaveLength(1);
    expect(list[0].serverUrl).toBe('a.lan/'); // newest entry wins
  });

  it('moves a re-used server to the front and refreshes token + lastUsedAt', () => {
    const start = [srv('https://a.lan', 'old', 1), srv('https://b.lan', 'b', 2)];
    const list = upsertServer(start, srv('https://a.lan', 'new', 99));
    expect(list.map((s) => s.serverUrl)).toEqual(['https://a.lan', 'https://b.lan']);
    expect(list[0].token).toBe('new');
    expect(list[0].lastUsedAt).toBe(99);
  });

  it('caps the list at MAX_SERVERS, dropping the oldest', () => {
    let list: SavedServer[] = [];
    for (let i = 0; i < 8; i++) list = upsertServer(list, srv(`https://s${i}.lan`));
    expect(list).toHaveLength(6);
    expect(list[0].serverUrl).toBe('https://s7.lan'); // newest first
    expect(list.some((s) => s.serverUrl === 'https://s0.lan')).toBe(false); // oldest dropped
  });
});

describe('removeServer', () => {
  it('removes the matching server (normalized)', () => {
    const list = removeServer([srv('https://a.lan'), srv('https://b.lan')], 'a.lan/');
    expect(list.map((s) => s.serverUrl)).toEqual(['https://b.lan']);
  });

  it('is a no-op for an unknown URL', () => {
    const start = [srv('https://a.lan')];
    expect(removeServer(start, 'https://z.lan')).toEqual(start);
  });
});

describe('persistence', () => {
  it('returns [] when nothing is saved', async () => {
    expect(await loadServers()).toEqual([]);
  });

  it('round-trips saved servers', async () => {
    const list = [srv('https://a.lan'), srv('https://b.lan')];
    await persistServers(list);
    expect(await loadServers()).toEqual(list);
  });
});
