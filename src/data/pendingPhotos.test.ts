import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearPendingPhoto, clearPendingPhotos, loadPendingPhotos, setPendingPhoto } from '@/data/pendingPhotos';
import type { PendingPhoto } from '@/data/pendingPhotos';

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

const set = (uri: string): PendingPhoto => ({ kind: 'set', uri, name: 'pick.jpg', type: 'image/jpeg' });

beforeEach(() => {
  mem.store.clear();
});

describe('pendingPhotos persistence', () => {
  it('returns {} when nothing is saved', async () => {
    expect(await loadPendingPhotos()).toEqual({});
  });

  it('round-trips a set record under its child id', async () => {
    await setPendingPhoto('c1', set('file:///doc/a.jpg'));
    expect(await loadPendingPhotos()).toEqual({ c1: set('file:///doc/a.jpg') });
  });

  it('keeps separate children apart', async () => {
    await setPendingPhoto('c1', set('file:///doc/a.jpg'));
    await setPendingPhoto('c2', { kind: 'remove' });
    expect(await loadPendingPhotos()).toEqual({ c1: set('file:///doc/a.jpg'), c2: { kind: 'remove' } });
  });

  it('overwrites a child rather than accumulating, and hands back what it replaced', async () => {
    // Re-picking a photo offline replaces the pending one. Returning the old
    // record is what lets the caller delete the file it pointed at instead of
    // leaving it for the sweep.
    await setPendingPhoto('c1', set('file:///doc/a.jpg'));
    const prev = await setPendingPhoto('c1', set('file:///doc/b.jpg'));
    expect(prev).toEqual(set('file:///doc/a.jpg'));
    expect(await loadPendingPhotos()).toEqual({ c1: set('file:///doc/b.jpg') });
  });

  it('returns undefined when there was nothing to replace', async () => {
    expect(await setPendingPhoto('c1', set('file:///doc/a.jpg'))).toBeUndefined();
  });

  it('clears one child and returns the record it removed', async () => {
    await setPendingPhoto('c1', set('file:///doc/a.jpg'));
    await setPendingPhoto('c2', set('file:///doc/b.jpg'));
    expect(await clearPendingPhoto('c1')).toEqual(set('file:///doc/a.jpg'));
    expect(await loadPendingPhotos()).toEqual({ c2: set('file:///doc/b.jpg') });
  });

  it('clearing an absent child is a no-op returning undefined', async () => {
    expect(await clearPendingPhoto('nobody')).toBeUndefined();
    expect(await loadPendingPhotos()).toEqual({});
  });

  it('clears every child at once', async () => {
    await setPendingPhoto('c1', set('file:///doc/a.jpg'));
    await clearPendingPhotos();
    expect(await loadPendingPhotos()).toEqual({});
  });

  it('reads corrupt stored JSON as empty rather than throwing', async () => {
    mem.store.set('budkin.pendingPhotos.v1', '{not json');
    expect(await loadPendingPhotos()).toEqual({});
  });

  it('serializes mutations, so one landing during another is not clobbered', async () => {
    // The reason `removePendingOp` re-reads too: a caller holding a stale
    // snapshot must not clobber a write that landed after it read.
    await setPendingPhoto('c1', set('file:///doc/a.jpg'));
    await Promise.all([setPendingPhoto('c2', set('file:///doc/b.jpg')), clearPendingPhoto('c1')]);
    const map = await loadPendingPhotos();
    expect(map.c2).toEqual(set('file:///doc/b.jpg'));
  });

  it('a rejected mutation does not poison the ones queued behind it', async () => {
    await setPendingPhoto('c1', set('file:///doc/a.jpg'));
    await Promise.all([setPendingPhoto('c2', set('file:///doc/b.jpg')), setPendingPhoto('c3', set('file:///doc/c.jpg'))]);
    expect(await loadPendingPhotos()).toEqual({
      c1: set('file:///doc/a.jpg'),
      c2: set('file:///doc/b.jpg'),
      c3: set('file:///doc/c.jpg'),
    });
  });
});
