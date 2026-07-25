import { describe, it, expect } from 'vitest';

import { valueAtZ, hasWhoAgeOverlap, MONTH_MS, referenceCurves } from './whoReference';

describe('valueAtZ (WHO LMS formula)', () => {
  // WHO girls weight-for-age, month 0: L=0.3809, M=3.2322, S=0.14171.
  // Median (z=0) is exactly M; P3 (z=-1.88079) and P97 (z=+1.88079) match
  // WHO's published 3rd/97th centiles (2.4 / 4.2 kg to one decimal).
  const lms = { L: 0.3809, M: 3.2322, S: 0.14171 };
  it('returns M at z=0', () => {
    expect(valueAtZ(lms, 0)).toBeCloseTo(3.2322, 3);
  });
  it('matches WHO 3rd and 97th centiles', () => {
    expect(valueAtZ(lms, -1.88079)).toBeCloseTo(2.4, 1);
    expect(valueAtZ(lms, 1.88079)).toBeCloseTo(4.2, 1);
  });
  it('uses the exp branch when L is ~0', () => {
    // L=0 => X = M*exp(S*z)
    expect(valueAtZ({ L: 0, M: 16, S: 0.1 }, 1)).toBeCloseTo(16 * Math.exp(0.1), 5);
  });
});

describe('hasWhoAgeOverlap', () => {
  const birth = 1_000_000_000_000;
  it('true when the range sits inside 0..60 months', () => {
    expect(hasWhoAgeOverlap(birth, birth + 2 * MONTH_MS, birth + 10 * MONTH_MS)).toBe(true);
  });
  it('false when the whole range is past 60 months', () => {
    expect(hasWhoAgeOverlap(birth, birth + 61 * MONTH_MS, birth + 70 * MONTH_MS)).toBe(false);
  });
  it('true when the range straddles birth (age 0)', () => {
    expect(hasWhoAgeOverlap(birth, birth - 5 * MONTH_MS, birth + 3 * MONTH_MS)).toBe(true);
  });
});

describe('referenceCurves', () => {
  const birth = 1_700_000_000_000;
  const tMin = birth + 1 * MONTH_MS;
  const tMax = birth + 6 * MONTH_MS;

  it('returns null for an unset gender', () => {
    expect(referenceCurves('weight', undefined, birth, tMin, tMax, 'metric')).toBeNull();
  });

  it('returns null when the whole range is past 60 months', () => {
    const late = birth + 61 * MONTH_MS;
    expect(referenceCurves('weight', 'girl', birth, late, late + MONTH_MS, 'metric')).toBeNull();
  });

  it('produces five curves with endpoints at tMin and tMax', () => {
    const curves = referenceCurves('weight', 'girl', birth, tMin, tMax, 'metric');
    expect(curves).not.toBeNull();
    expect(curves!.map((c) => c.p)).toEqual([3, 15, 50, 85, 97]);
    for (const c of curves!) {
      expect(c.points[0].t).toBe(tMin);
      expect(c.points[c.points.length - 1].t).toBe(tMax);
      expect(c.points.every((p, i, a) => i === 0 || p.t >= a[i - 1].t)).toBe(true);
    }
  });

  it('clamps the last sample to age 60 months when the range straddles it', () => {
    const t60 = birth + 60 * MONTH_MS;
    const curves = referenceCurves('weight', 'boy', birth, birth + 58 * MONTH_MS, birth + 64 * MONTH_MS, 'metric');
    expect(curves).not.toBeNull();
    for (const c of curves!) expect(c.points[c.points.length - 1].t).toBe(t60);
  });

  it('converts to imperial (weight in lb > metric kg)', () => {
    const metric = referenceCurves('weight', 'girl', birth, tMin, tMax, 'metric')!;
    const imperial = referenceCurves('weight', 'girl', birth, tMin, tMax, 'imperial')!;
    const m50 = metric.find((c) => c.p === 50)!.points[0].value;
    const i50 = imperial.find((c) => c.p === 50)!.points[0].value;
    expect(i50).toBeGreaterThan(m50 * 2); // ~2.2 lb per kg
  });
});
