import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addPendingOp, clearPendingOps, loadPendingOps, savePendingOps } from '@/data/pendingOps';
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
