import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addPendingOp, clearPendingOps, loadPendingOps, removePendingOp, savePendingOps } from '@/data/pendingOps';
import type { PendingOp } from '@/data/pendingOps';
import type { Child } from '@/types/models';

// In-memory stand-in for the native AsyncStorage module.
const mem = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => mem.store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      mem.store.set(k, v);
    }),
    removeItem: vi.fn(async (k: string) => {
      mem.store.delete(k);
    }),
  },
}));

const child = (id: string): Child => ({
  id,
  serverId: 1,
  first: 'Ada',
  last: 'Lovelace',
  birth: 0,
  color: '#fff',
});

const updateChildOp = (id: string): PendingOp => ({ op: 'update', entity: 'child', payload: child(id) });

beforeEach(() => {
  mem.store.clear();
});

describe('pendingOps persistence', () => {
  it('returns [] when nothing is saved', async () => {
    expect(await loadPendingOps()).toEqual([]);
  });

  it('round-trips an appended update op', async () => {
    const list = await addPendingOp(updateChildOp('a'));
    expect(list).toEqual([updateChildOp('a')]);
    expect(await loadPendingOps()).toEqual([updateChildOp('a')]);
  });

  it('preserves append order across multiple calls', async () => {
    await addPendingOp(updateChildOp('a'));
    await addPendingOp(updateChildOp('b'));
    const list = await addPendingOp(updateChildOp('c'));
    expect(list).toEqual([updateChildOp('a'), updateChildOp('b'), updateChildOp('c')]);
    expect(await loadPendingOps()).toEqual([updateChildOp('a'), updateChildOp('b'), updateChildOp('c')]);
  });

  it('round-trips a delete entry op with its serverId + entryType', async () => {
    const op: PendingOp = { op: 'delete', entity: 'entry', entryType: 'sleep', serverId: 42 };
    await addPendingOp(op);
    expect(await loadPendingOps()).toEqual([op]);
  });

  it('round-trips a delete measurement op with its serverId + kind', async () => {
    const op: PendingOp = { op: 'delete', entity: 'measurement', kind: 'weight', serverId: 7 };
    await addPendingOp(op);
    expect(await loadPendingOps()).toEqual([op]);
  });

  it('returns [] when the persisted JSON is corrupt', async () => {
    mem.store.set('budkin.pendingOps.v1', '{not valid json');
    expect(await loadPendingOps()).toEqual([]);
  });

  it('clears saved ops', async () => {
    await addPendingOp(updateChildOp('a'));
    await clearPendingOps();
    expect(await loadPendingOps()).toEqual([]);
  });

  it('savePendingOps persists a full list for loadPendingOps to return', async () => {
    const ops = [updateChildOp('a'), updateChildOp('b')];
    await savePendingOps(ops);
    expect(await loadPendingOps()).toEqual(ops);
  });

  it('round-trips a bath rhythm op keyed by LOCAL child id', async () => {
    // Local id, not server id: the child may not be on the server yet when the rhythm
    // is edited, and the replay resolves the server id from state at flush time.
    const op: PendingOp = {
      op: 'update',
      entity: 'bathRhythm',
      childId: 'child123',
      rhythm: { fullEveryDays: 4, quickEveryDays: 0 },
    };
    await addPendingOp(op);
    expect(await loadPendingOps()).toEqual([op]);
  });

  it('round-trips timer update and delete ops', async () => {
    const timer = { id: 't1', activity: 'sleep', saveAs: 'sleep', name: 'Sleep', start: 0, serverId: 5 } as const;
    await addPendingOp({ op: 'update', entity: 'timer', payload: timer });
    await addPendingOp({ op: 'delete', entity: 'timer', serverId: 9 });
    expect(await loadPendingOps()).toEqual([
      { op: 'update', entity: 'timer', payload: timer },
      { op: 'delete', entity: 'timer', serverId: 9 },
    ]);
  });
});

describe('removePendingOp (per-op removal, backs flushPendingOps bookkeeping)', () => {
  it('removes the op by value, persists the rest, and returns the remaining list', async () => {
    await addPendingOp(updateChildOp('a'));
    await addPendingOp(updateChildOp('b'));
    const remaining = await removePendingOp(updateChildOp('a'));
    expect(remaining).toEqual([updateChildOp('b')]);
    expect(await loadPendingOps()).toEqual([updateChildOp('b')]);
  });

  it('removes only the FIRST of two identical ops (multiset semantics)', async () => {
    // Two identical offline renames queue two identical ops on purpose (no
    // dedup); completing one replay must drop exactly one of them.
    await addPendingOp(updateChildOp('a'));
    await addPendingOp(updateChildOp('a'));
    const remaining = await removePendingOp(updateChildOp('a'));
    expect(remaining).toEqual([updateChildOp('a')]);
    expect(await loadPendingOps()).toEqual([updateChildOp('a')]);
  });

  it('matches an op that went through a JSON round-trip (a reloaded file)', async () => {
    // flushPendingOps removes the objects loadPendingOps gave it, parsed copies of
    // what addPendingOp serialized, not the reference-identical originals.
    await addPendingOp(updateChildOp('a'));
    const [reloaded] = await loadPendingOps();
    expect(await removePendingOp(reloaded)).toEqual([]);
    expect(await loadPendingOps()).toEqual([]);
  });

  it('leaves the file untouched when the op is not on it', async () => {
    await addPendingOp(updateChildOp('a'));
    const remaining = await removePendingOp(updateChildOp('zzz'));
    expect(remaining).toEqual([updateChildOp('a')]);
    expect(await loadPendingOps()).toEqual([updateChildOp('a')]);
  });

  it('keeps an op appended after the caller last read the file (no clobber)', async () => {
    // Per-op removal re-reads the file, so an op appended mid-flush survives
    // instead of being overwritten by a stale end-of-run list.
    await addPendingOp(updateChildOp('a'));
    await addPendingOp(updateChildOp('late'));
    expect(await removePendingOp(updateChildOp('a'))).toEqual([updateChildOp('late')]);
  });
});
