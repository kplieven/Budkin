import { describe, expect, it, vi } from 'vitest';

import { matchServerChild, uploadUnsynced } from '@/data/sync';
import type { UploadDeps, UploadState } from '@/data/sync';
import type { Child, DiaperEntry, Entry, Measurement } from '@/types/models';

const child = (overrides: Partial<Child> = {}): Child => ({
  id: 'c1',
  first: 'Ada',
  last: 'Lovelace',
  birth: 0,
  color: '#fff',
  ...overrides,
});

const diaperEntry = (overrides: Partial<DiaperEntry> = {}): DiaperEntry => ({
  id: 'e1',
  childId: 'c1',
  tags: [],
  type: 'diaper',
  time: 0,
  wet: true,
  solid: false,
  color: null,
  ...overrides,
});

const measurement = (overrides: Partial<Measurement> = {}): Measurement => ({
  id: 'm1',
  childId: 'c1',
  kind: 'weight',
  value: 5,
  date: 0,
  ...overrides,
});

const emptyState = (): UploadState => ({ children: [], entries: [], measurements: [] });

const makeDeps = (overrides: Partial<UploadDeps> = {}): UploadDeps => ({
  pushChild: vi.fn(async () => 100),
  pushEntry: vi.fn(async () => 200),
  pushMeasurement: vi.fn(async () => 300),
  ...overrides,
});

describe('uploadUnsynced', () => {
  it('uploads children before entries and measurements', async () => {
    const log: string[] = [];
    const state: UploadState = {
      children: [child({ id: 'c1' })],
      entries: [diaperEntry({ id: 'e1', childId: 'c1' })],
      measurements: [measurement({ id: 'm1', childId: 'c1' })],
    };
    const deps: UploadDeps = {
      pushChild: vi.fn(async (c) => {
        log.push(`child:${c.id}`);
        return 10;
      }),
      pushEntry: vi.fn(async (e) => {
        log.push(`entry:${e.id}`);
        return 20;
      }),
      pushMeasurement: vi.fn(async (m) => {
        log.push(`measurement:${m.id}`);
        return 30;
      }),
    };

    await uploadUnsynced(state, deps);

    expect(log).toEqual(['child:c1', 'entry:e1', 'measurement:m1']);
  });

  it('passes the newly-assigned server child id alongside the entry (childId stays local)', async () => {
    const state: UploadState = {
      children: [child({ id: 'child1', serverId: undefined })],
      entries: [diaperEntry({ id: 'e1', childId: 'child1' })],
      measurements: [],
    };
    const pushEntry = vi.fn(async () => 200);
    const deps = makeDeps({ pushChild: vi.fn(async () => 10), pushEntry });

    await uploadUnsynced(state, deps);

    expect(pushEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1', childId: 'child1' }), 10);
  });

  it('passes the newly-assigned server child id alongside the measurement (childId stays local)', async () => {
    const state: UploadState = {
      children: [child({ id: 'child1', serverId: undefined })],
      entries: [],
      measurements: [measurement({ id: 'm1', childId: 'child1' })],
    };
    const pushMeasurement = vi.fn(async () => 300);
    const deps = makeDeps({ pushChild: vi.fn(async () => 42), pushMeasurement });

    await uploadUnsynced(state, deps);

    expect(pushMeasurement).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1', childId: 'child1' }), 42);
  });

  it('does not push a child that already has a serverId', async () => {
    const pushChild = vi.fn(async () => 999);
    const state: UploadState = {
      ...emptyState(),
      children: [child({ id: 'c1', serverId: 5 })],
    };

    const result = await uploadUnsynced(state, makeDeps({ pushChild }));

    expect(pushChild).not.toHaveBeenCalled();
    expect(result.children[0].serverId).toBe(5);
  });

  it('leaves a child unsynced and skips its entries/measurements when pushChild returns undefined', async () => {
    const pushEntry = vi.fn(async () => 55);
    const pushMeasurement = vi.fn(async () => 66);
    const state: UploadState = {
      children: [child({ id: 'c1', serverId: undefined })],
      entries: [diaperEntry({ id: 'e1', childId: 'c1' })],
      measurements: [measurement({ id: 'm1', childId: 'c1' })],
    };

    const result = await uploadUnsynced(
      state,
      makeDeps({ pushChild: vi.fn(async () => undefined), pushEntry, pushMeasurement }),
    );

    expect(result.children[0].serverId).toBeUndefined();
    expect(pushEntry).not.toHaveBeenCalled();
    expect(pushMeasurement).not.toHaveBeenCalled();
    expect(result.entries[0].serverId).toBeUndefined();
    expect(result.measurements[0].serverId).toBeUndefined();
  });

  it('leaves a child unsynced when pushChild throws, and does not abort the rest', async () => {
    const otherPushChild = vi.fn(async (_c: Child) => 11);
    const state: UploadState = {
      children: [child({ id: 'c1', serverId: undefined }), child({ id: 'c2', serverId: undefined })],
      entries: [],
      measurements: [],
    };
    const pushChild = vi.fn(async (c: Child) => {
      if (c.id === 'c1') throw new Error('network down');
      return otherPushChild(c);
    });

    const result = await uploadUnsynced(state, makeDeps({ pushChild }));

    expect(result.children.find((c) => c.id === 'c1')?.serverId).toBeUndefined();
    expect(result.children.find((c) => c.id === 'c2')?.serverId).toBe(11);
  });

  it('does not push an entry or measurement that already has a serverId', async () => {
    const pushEntry = vi.fn(async () => 999);
    const pushMeasurement = vi.fn(async () => 888);
    const state: UploadState = {
      children: [child({ id: 'c1', serverId: 5 })],
      entries: [diaperEntry({ id: 'e1', childId: 'c1', serverId: 99 })],
      measurements: [measurement({ id: 'm1', childId: 'c1', serverId: 99 })],
    };

    const result = await uploadUnsynced(state, makeDeps({ pushEntry, pushMeasurement }));

    expect(pushEntry).not.toHaveBeenCalled();
    expect(pushMeasurement).not.toHaveBeenCalled();
    expect(result.entries[0].serverId).toBe(99);
    expect(result.measurements[0].serverId).toBe(99);
  });

  it('leaves an entry unsynced when pushEntry returns undefined, and does not abort the rest', async () => {
    const otherPushEntry = vi.fn(async (_e: Entry) => 21);
    const state: UploadState = {
      children: [child({ id: 'c1', serverId: 1 })],
      entries: [diaperEntry({ id: 'e1', childId: 'c1' }), diaperEntry({ id: 'e2', childId: 'c1' })],
      measurements: [measurement({ id: 'm1', childId: 'c1' })],
    };
    const pushEntry = vi.fn(async (e: Entry) => (e.id === 'e1' ? undefined : otherPushEntry(e)));

    const result = await uploadUnsynced(state, makeDeps({ pushEntry }));

    expect(result.entries.find((e) => e.id === 'e1')?.serverId).toBeUndefined();
    expect(result.entries.find((e) => e.id === 'e2')?.serverId).toBe(21);
    expect(result.measurements[0].serverId).toBe(300);
  });

  it('leaves an entry unsynced when pushEntry throws, and does not abort the rest', async () => {
    const otherPushEntry = vi.fn(async (_e: Entry) => 22);
    const state: UploadState = {
      children: [child({ id: 'c1', serverId: 1 })],
      entries: [diaperEntry({ id: 'e1', childId: 'c1' }), diaperEntry({ id: 'e2', childId: 'c1' })],
      measurements: [],
    };
    const pushEntry = vi.fn(async (e: Entry) => {
      if (e.id === 'e1') throw new Error('network down');
      return otherPushEntry(e);
    });

    const result = await uploadUnsynced(state, makeDeps({ pushEntry }));

    expect(result.entries.find((e) => e.id === 'e1')?.serverId).toBeUndefined();
    expect(result.entries.find((e) => e.id === 'e2')?.serverId).toBe(22);
  });

  it('pushes an entry under an already-synced parent using its existing server id', async () => {
    const pushEntry = vi.fn(async () => 77);
    const state: UploadState = {
      children: [child({ id: '7', serverId: 7 })],
      entries: [diaperEntry({ id: 'e1', childId: '7' })],
      measurements: [],
    };

    await uploadUnsynced(state, makeDeps({ pushEntry }));

    expect(pushEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1', childId: '7' }), 7);
  });

  it('calls onProgress once per unsynced record, monotonically reaching total', async () => {
    const state: UploadState = {
      children: [child({ id: 'c1', serverId: undefined }), child({ id: 'c2', serverId: 2 })],
      entries: [diaperEntry({ id: 'e1', childId: 'c1' })],
      measurements: [measurement({ id: 'm1', childId: 'c1' })],
    };
    const calls: Array<[number, number]> = [];

    await uploadUnsynced(state, makeDeps(), (done, total) => calls.push([done, total]));

    // total = 1 unsynced child + 1 entry + 1 measurement (c2 already synced, doesn't count)
    expect(calls.map(([, total]) => total)).toEqual([3, 3, 3]);
    expect(calls.map(([done]) => done)).toEqual([1, 2, 3]);
  });

  it('does not mutate the input state', async () => {
    const state: UploadState = {
      children: [child({ id: 'c1' })],
      entries: [diaperEntry({ id: 'e1', childId: 'c1' })],
      measurements: [measurement({ id: 'm1', childId: 'c1' })],
    };
    const snapshot = JSON.parse(JSON.stringify(state));

    await uploadUnsynced(state, makeDeps());

    expect(state).toEqual(snapshot);
  });
});

describe('matchServerChild', () => {
  const localMidnight = new Date(2020, 5, 15, 0, 0, 0).getTime();
  const sameDayMidday = new Date(2020, 5, 15, 13, 30, 0).getTime();
  const differentDay = new Date(2020, 5, 16, 0, 0, 0).getTime();

  it('returns the serverId when first name (case/space-insensitive) and birth day match', () => {
    const local = child({ first: '  ada  ', birth: localMidnight });
    const serverChildren = [child({ id: 's1', serverId: 7, first: 'Ada', birth: localMidnight })];

    expect(matchServerChild(local, serverChildren)).toBe(7);
  });

  it('returns null when the name differs', () => {
    const local = child({ first: 'Ada', birth: localMidnight });
    const serverChildren = [child({ id: 's1', serverId: 7, first: 'Grace', birth: localMidnight })];

    expect(matchServerChild(local, serverChildren)).toBeNull();
  });

  it('returns null when the birth day differs, even with the same name', () => {
    const local = child({ first: 'Ada', birth: localMidnight });
    const serverChildren = [child({ id: 's1', serverId: 7, first: 'Ada', birth: differentDay })];

    expect(matchServerChild(local, serverChildren)).toBeNull();
  });

  it('matches when births fall on the same calendar day but differ in time-of-day', () => {
    const local = child({ first: 'Ada', birth: sameDayMidday });
    const serverChildren = [child({ id: 's1', serverId: 7, first: 'Ada', birth: localMidnight })];

    expect(matchServerChild(local, serverChildren)).toBe(7);
  });

  it('returns null when there are no server children', () => {
    const local = child({ first: 'Ada', birth: localMidnight });

    expect(matchServerChild(local, [])).toBeNull();
  });
});
