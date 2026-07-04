import { describe, expect, it } from 'vitest';

import { buildSleepEntry, startSleepTimer } from '@/data/sleepTimer';
import type { Timer } from '@/types/models';

describe('startSleepTimer', () => {
  it('creates a running sleep timer starting at now', () => {
    const t = startSleepTimer(1000);
    expect(t).toMatchObject({ activity: 'sleep', saveAs: 'sleep', name: 'Sleep', start: 1000 });
    expect(t.id).toBe('t1000');
  });
});

describe('buildSleepEntry', () => {
  const base: Timer = { id: 't1', activity: 'sleep', name: 'Sleep', start: 1000, saveAs: 'sleep' };

  it('spans the timer start to now and stamps the child', () => {
    const e = buildSleepEntry(base, 5000, 'c1');
    expect(e).toMatchObject({ type: 'sleep', start: 1000, end: 5000, childId: 'c1', tags: [] });
    expect(e.id).toBe('e5000');
  });

  it('derives nap=true during the day and false at night', () => {
    const noon = new Date(2026, 0, 1, 12, 0, 0).getTime();
    const night = new Date(2026, 0, 1, 2, 0, 0).getTime();
    expect(buildSleepEntry(base, noon, 'c1').nap).toBe(true);
    expect(buildSleepEntry(base, night, 'c1').nap).toBe(false);
  });

  it('honors an explicit nap flag on the timer', () => {
    const noon = new Date(2026, 0, 1, 12, 0, 0).getTime();
    expect(buildSleepEntry({ ...base, nap: false }, noon, 'c1').nap).toBe(false);
  });

  it('carries the timer tags', () => {
    expect(buildSleepEntry({ ...base, tags: ['x'] }, 5000, 'c1').tags).toEqual(['x']);
  });
});
