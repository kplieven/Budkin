import { describe, expect, it } from 'vitest';

import { timerChildSuffix } from '@/features/timers/timerAttribution';

const kids = [
  { id: 'c1', first: 'Mara' },
  { id: 'c2', first: 'Tom' },
];

describe('timerChildSuffix', () => {
  it("names the timer's own child once a household has two", () => {
    expect(timerChildSuffix('c2', kids)).toEqual({ drawn: ' · Tom', spoken: ', Tom' });
  });

  it('draws the middle dot and speaks a comma, from the same name', () => {
    // The whole reason both forms come out of one call: a screen reader saying
    // "middle dot" is noise, and the two must never name different children.
    const s = timerChildSuffix('c1', kids);
    expect(s.drawn).toBe(' · Mara');
    expect(s.spoken).toBe(', Mara');
  });

  it('stays silent in a single-child household', () => {
    expect(timerChildSuffix('c1', [{ id: 'c1', first: 'Mara' }])).toEqual({ drawn: '', spoken: '' });
  });

  it('stays silent for a timer whose child is no longer on the device', () => {
    expect(timerChildSuffix('gone', kids)).toEqual({ drawn: '', spoken: '' });
  });

  it('stays silent for a legacy timer that carries no owner at all', () => {
    // `Timer.childId` is optional because the persisted payloads are cast, not
    // validated. An unattributable timer shows no suffix rather than being
    // filed under whoever happens to be selected.
    expect(timerChildSuffix(undefined, kids)).toEqual({ drawn: '', spoken: '' });
  });
});
