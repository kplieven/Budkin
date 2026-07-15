import { describe, expect, it } from 'vitest';

import {
  decodeTimerName,
  encodeTimerName,
  reconcileTimers,
  serverTimerToTimer,
} from '@/data/serverTimers';
import type { Timer } from '@/types/models';

const base = (over: Partial<Timer>): Timer => ({
  id: 't1',
  activity: 'feeding',
  name: 'Feeding',
  start: 0,
  saveAs: 'feeding',
  ...over,
});

describe('encode/decode timer name', () => {
  it('round-trips a feeding timer with structural fields + amount', () => {
    const t = base({ saveAs: 'feeding', feedType: 'formula', method: 'bottle', amount: 90 });
    const name = encodeTimerName(t);
    expect(name).toBe('Feeding · v1 · ft:formula · m:bottle · amt:90');
    expect(decodeTimerName(name)).toMatchObject({
      saveAs: 'feeding',
      feedType: 'formula',
      method: 'bottle',
      amount: 90,
    });
  });

  it('carries the breastfeeding start side', () => {
    const t = base({ saveAs: 'feeding', feedType: 'breast', method: 'both', startSide: 'right' });
    expect(decodeTimerName(encodeTimerName(t))).toMatchObject({ method: 'both', startSide: 'right' });
  });

  it('round-trips a pumping timer amount', () => {
    const t = base({ saveAs: 'pumping', method: 'bottle', amount: 120 });
    expect(decodeTimerName(encodeTimerName(t))).toMatchObject({ saveAs: 'pumping', amount: 120 });
  });

  it('encodes the nap flag only when true', () => {
    expect(encodeTimerName(base({ saveAs: 'sleep', nap: true }))).toBe('Sleep · v1 · nap');
    expect(encodeTimerName(base({ saveAs: 'sleep', nap: false }))).toBe('Sleep · v1');
    expect(decodeTimerName('Sleep · v1 · nap')).toMatchObject({ saveAs: 'sleep', nap: true });
    expect(decodeTimerName('Sleep · v1').nap).toBeUndefined();
  });

  it('falls back to a generic feeding timer for a foreign/unmarked name', () => {
    expect(decodeTimerName('Kitchen nap timer')).toMatchObject({ saveAs: 'feeding' });
    // a foreign name must not leak structural fields
    expect(decodeTimerName('Kitchen nap timer').nap).toBeUndefined();
  });

  it('reconstructs a Timer from a server record', () => {
    const t = serverTimerToTimer({ id: 7, name: 'Sleep · v1 · nap', start: 1000 }, 'c1');
    expect(t).toMatchObject({
      id: 'tsrv7',
      serverId: 7,
      childId: 'c1',
      saveAs: 'sleep',
      nap: true,
      start: 1000,
      name: 'Sleep',
    });
  });
});

describe('reconcileTimers', () => {
  const srv = (id: number, over: Partial<Timer> = {}): Timer => ({
    id: `tsrv${id}`,
    serverId: id,
    childId: 'c1',
    activity: 'sleep',
    saveAs: 'sleep',
    name: 'Sleep',
    start: 0,
    ...over,
  });

  it('keeps unsynced local timers (serverId == null)', () => {
    const local: Timer[] = [
      { id: 't-local', activity: 'feeding', saveAs: 'feeding', name: 'Feeding', start: 5 },
    ];
    expect(reconcileTimers(local, [])).toEqual(local);
  });

  it('drops a synced local timer that is gone from the server', () => {
    expect(reconcileTimers([srv(1)], [])).toEqual([]);
  });

  it('refreshes a matched timer from the server but preserves local notes/tags', () => {
    const local = [srv(1, { id: 't-keep', nap: false, notes: 'mine', tags: ['x'], start: 100 })];
    const server = [srv(1, { nap: true, start: 200 })];
    const out = reconcileTimers(local, server);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 't-keep', nap: true, start: 200, notes: 'mine', tags: ['x'] });
  });

  it('adds a server timer with no local match', () => {
    expect(reconcileTimers([], [srv(9)])).toEqual([srv(9)]);
  });
});
