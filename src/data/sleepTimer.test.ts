import { describe, expect, it } from 'vitest';

import { buildSleepEntry, startSleepTimer } from '@/data/sleepTimer';
import type { Timer } from '@/types/models';

describe('startSleepTimer', () => {
  it('creates a running sleep timer starting at now, stamped with the owning child', () => {
    const t = startSleepTimer(1000, 'c1');
    expect(t).toMatchObject({ activity: 'sleep', saveAs: 'sleep', name: 'Sleep', start: 1000, childId: 'c1' });
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

  it('derives nap from the START of the sleep, not the wake', () => {
    // The classifying instant is the timer's start. A nap begun at noon and
    // slept through to 20:00 is still a nap; a night sleep begun at 22:00 and
    // woken from at 08:00 is still night sleep. Keying on the wake time (as
    // this did before) made the answer flip once the record round-tripped
    // through Baby Buddy, which classifies on start only.
    const startNoon = new Date(2026, 0, 1, 12, 0, 0).getTime();
    const wakeEvening = new Date(2026, 0, 1, 20, 0, 0).getTime();
    expect(buildSleepEntry({ ...base, start: startNoon }, wakeEvening, 'c1').nap).toBe(true);

    const startNight = new Date(2026, 0, 1, 22, 0, 0).getTime();
    const wakeMorning = new Date(2026, 0, 2, 8, 0, 0).getTime();
    expect(buildSleepEntry({ ...base, start: startNight }, wakeMorning, 'c1').nap).toBe(false);
  });

  it('honors an explicit nap flag on the timer over the window', () => {
    const startNoon = new Date(2026, 0, 1, 12, 0, 0).getTime();
    const wake = new Date(2026, 0, 1, 14, 0, 0).getTime();
    expect(buildSleepEntry({ ...base, start: startNoon, nap: false }, wake, 'c1').nap).toBe(false);

    const startNight = new Date(2026, 0, 1, 23, 0, 0).getTime();
    const wakeLater = new Date(2026, 0, 2, 6, 0, 0).getTime();
    expect(buildSleepEntry({ ...base, start: startNight, nap: true }, wakeLater, 'c1').nap).toBe(true);
  });

  it('classifies against a caller-supplied nap window', () => {
    // The widget task has no store, so the window arrives as an argument.
    const startNine = new Date(2026, 0, 1, 9, 0, 0).getTime();
    const wake = new Date(2026, 0, 1, 11, 0, 0).getTime();
    expect(buildSleepEntry({ ...base, start: startNine }, wake, 'c1', { startMin: 600, endMin: 1140 }).nap).toBe(false);
    expect(buildSleepEntry({ ...base, start: startNine }, wake, 'c1', { startMin: 480, endMin: 1140 }).nap).toBe(true);
  });

  it('defaults to the 07:00-19:00 window when no window is passed', () => {
    const startNoon = new Date(2026, 0, 1, 12, 0, 0).getTime();
    const startNight = new Date(2026, 0, 1, 2, 0, 0).getTime();
    const wake = new Date(2026, 0, 2, 12, 30, 0).getTime();
    expect(buildSleepEntry({ ...base, start: startNoon }, wake, 'c1').nap).toBe(true);
    expect(buildSleepEntry({ ...base, start: startNight }, wake, 'c1').nap).toBe(false);
  });

  it('carries the timer tags', () => {
    expect(buildSleepEntry({ ...base, tags: ['x'] }, 5000, 'c1').tags).toEqual(['x']);
  });
});
