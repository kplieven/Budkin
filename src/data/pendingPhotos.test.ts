import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearPendingPhoto,
  clearPendingPhotoIf,
  clearPendingPhotos,
  loadPendingPhotos,
  setPendingPhoto,
} from '@/data/pendingPhotos';
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
    // Returning the replaced record is what lets the caller delete the file it
    // pointed at instead of leaving it for the sweep.
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

  it('clears conditionally when the record is still the one that was consumed', async () => {
    await setPendingPhoto('c1', set('file:///doc/a.jpg'));
    expect(await clearPendingPhotoIf('c1', set('file:///doc/a.jpg'))).toEqual(set('file:///doc/a.jpg'));
    expect(await loadPendingPhotos()).toEqual({});
  });

  it('matches by value, not by identity, because the record round-trips through JSON', async () => {
    await setPendingPhoto('c1', set('file:///doc/a.jpg'));
    const consumed = (await loadPendingPhotos()).c1; // a different object every read
    expect(await clearPendingPhotoIf('c1', consumed)).toBeDefined();
  });

  it('leaves a record written DURING the round trip alone', async () => {
    // A photo re-picked while the upload was in flight was never sent, so clearing
    // it here would delete it, file and all, with nothing left to upload it.
    await setPendingPhoto('c1', set('file:///doc/a.jpg'));
    await setPendingPhoto('c1', set('file:///doc/b.jpg'));
    expect(await clearPendingPhotoIf('c1', set('file:///doc/a.jpg'))).toBeUndefined();
    expect(await loadPendingPhotos()).toEqual({ c1: set('file:///doc/b.jpg') });
  });

  it('will not clear a set on behalf of a consumed removal, or the reverse', async () => {
    await setPendingPhoto('c1', { kind: 'remove' });
    expect(await clearPendingPhotoIf('c1', set('file:///doc/a.jpg'))).toBeUndefined();
    await setPendingPhoto('c2', set('file:///doc/a.jpg'));
    expect(await clearPendingPhotoIf('c2', { kind: 'remove' })).toBeUndefined();
    expect(await loadPendingPhotos()).toEqual({ c1: { kind: 'remove' }, c2: set('file:///doc/a.jpg') });
  });

  it('clears a consumed removal', async () => {
    await setPendingPhoto('c1', { kind: 'remove' });
    expect(await clearPendingPhotoIf('c1', { kind: 'remove' })).toEqual({ kind: 'remove' });
    expect(await loadPendingPhotos()).toEqual({});
  });

  it('conditionally clearing an absent child is a no-op returning undefined', async () => {
    expect(await clearPendingPhotoIf('nobody', set('file:///doc/a.jpg'))).toBeUndefined();
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
    // Both mutators are read-modify-write over one stored map, fired without being
    // awaited. Interleaved, each writes back the map it read and the second to
    // finish drops the first one's change. Re-reading at the start of each call
    // cannot fix that: both callers re-read the same map. Only ordering them does.
    await setPendingPhoto('c1', set('file:///doc/a.jpg'));
    await Promise.all([setPendingPhoto('c2', set('file:///doc/b.jpg')), clearPendingPhoto('c1')]);
    const map = await loadPendingPhotos();
    expect(map.c2).toEqual(set('file:///doc/b.jpg'));
  });

  it('serializes the conditional clear too, so a write landing beside it is not clobbered', async () => {
    // Unserialized, the clear would write back the map it read and drop `c2`.
    await setPendingPhoto('c1', set('file:///doc/a.jpg'));
    await Promise.all([
      setPendingPhoto('c2', set('file:///doc/b.jpg')),
      clearPendingPhotoIf('c1', set('file:///doc/a.jpg')),
    ]);
    expect(await loadPendingPhotos()).toEqual({ c2: set('file:///doc/b.jpg') });
  });

  it('a wipe landing during a mutation does not leave the record behind', async () => {
    await setPendingPhoto('c1', set('file:///doc/a.jpg'));
    await Promise.all([setPendingPhoto('c2', set('file:///doc/b.jpg')), clearPendingPhotos()]);
    expect(await loadPendingPhotos()).toEqual({});
  });
});
