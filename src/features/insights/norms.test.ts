import { describe, expect, it } from 'vitest';
import { NORMS, bandForRange, wakeWindowBand } from './norms';

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

  it('a floor norm (wet) has no upper bound: hi falls back to lo', () => {
    const young = birth + 2 * DAY;   // <=5d bucket → lo 4
    const older = birth + 30 * DAY;  // later bucket → lo 6
    const band = bandForRange(NORMS.wet, birth, [{ t: young }, { t: older }])!;
    expect(band.lo[0]).toBe(4);
    expect(band.hi[0]).toBe(band.lo[0]);
    expect(band.lo[1]).toBe(6);
    expect(band.hi[1]).toBe(band.lo[1]);
  });

  it('a ruleOfThumb norm (wakeWindow) yields a real band with hi above lo', () => {
    const band = bandForRange(NORMS.wakeWindow, birth, [{ t: birth + 30 * DAY }])!;
    expect(band.hi[0]).toBeGreaterThan(band.lo[0]);
  });
});

describe('wakeWindowBand', () => {
  it('returns the band for each age bucket', () => {
    expect(wakeWindowBand(0)).toMatchObject({ lo: 45, hi: 60 });
    expect(wakeWindowBand(30)).toMatchObject({ lo: 45, hi: 60 });
    expect(wakeWindowBand(31)).toMatchObject({ lo: 60, hi: 90 });
    expect(wakeWindowBand(90)).toMatchObject({ lo: 60, hi: 90 });
    expect(wakeWindowBand(180)).toMatchObject({ lo: 90, hi: 120 });
    expect(wakeWindowBand(365)).toMatchObject({ lo: 120, hi: 180 });
  });

  it('returns null past the age the source covers, rather than extrapolating', () => {
    // bucketFor falls back to the last bucket forever, which is right for
    // drawing a chart band and wrong for scheduling a nap nudge.
    expect(wakeWindowBand(366)).toBeNull();
    expect(wakeWindowBand(1200)).toBeNull();
  });

  it('returns null for a negative age', () => {
    expect(wakeWindowBand(-1)).toBeNull();
  });

  it('returns null for a non-finite age, rather than falling through to the last bucket', () => {
    // NaN fails both `ageDays < 0` and `ageDays > WAKE_WINDOW_MAX_AGE_DAYS`, so
    // without an explicit finite check it reaches `bucketFor`, whose loop
    // condition `NaN <= b.maxAgeDays` is always false and therefore returns the
    // LAST bucket instead of null.
    expect(wakeWindowBand(NaN)).toBeNull();
  });
});
