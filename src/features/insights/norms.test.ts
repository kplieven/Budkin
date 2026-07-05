import { describe, expect, it } from 'vitest';
import { NORMS, bandForRange } from './norms';

const DAY = 86400000;

describe('bandForRange', () => {
  const birth = new Date(2026, 0, 1).getTime();

  it('steps the total-sleep band down as the baby crosses 90 days', () => {
    const young = birth + 30 * DAY;   // ~1 mo → 14–17
    const older = birth + 200 * DAY;  // ~6.5 mo → 12–16
    const band = bandForRange(NORMS.totalSleep, birth, [{ t: young }, { t: older }])!;
    expect(band.hi[0]).toBe(17);
    expect(band.lo[0]).toBe(14);
    expect(band.hi[1]).toBe(16);
    expect(band.lo[1]).toBe(12);
  });

  it('returns null for a metric with no norm (dirty)', () => {
    expect(bandForRange(NORMS.dirty, birth, [{ t: birth + 40 * DAY }])).toBeNull();
  });

  it('clamps ages beyond the last bucket to that bucket', () => {
    const band = bandForRange(NORMS.totalSleep, birth, [{ t: birth + 5000 * DAY }])!;
    expect(band.lo[0]).toBe(11);
  });
});
