import { describe, it, expect } from 'vitest';

import { WHO_LMS } from './whoLms';
import { valueAtZ } from './whoReference';

// Accuracy gate. Each row is [kind, sex, month, SD2neg, median(SD0), SD2] taken from
// the WHO tables' OWN published SD columns, which are a DIFFERENT set of columns than
// the L/M/S we embed, so reconstructing them at z = -2, 0, +2 proves the transcription.
// If a case is off, fix the number in whoLms.ts, do not loosen the tolerance: WHO SD
// columns are rounded to one decimal, so 0.1 covers rounding.
const ORACLE: [keyof typeof WHO_LMS, 'girl' | 'boy', number, number, number, number][] = [
  ['weight', 'girl', 0, 2.4, 3.2, 4.2], ['weight', 'girl', 12, 7, 8.9, 11.5],
  ['weight', 'girl', 24, 9, 11.5, 14.8], ['weight', 'girl', 60, 13.7, 18.2, 24.9],
  ['weight', 'boy', 0, 2.5, 3.3, 4.4], ['weight', 'boy', 12, 7.7, 9.6, 12],
  ['weight', 'boy', 24, 9.7, 12.2, 15.3], ['weight', 'boy', 60, 14.1, 18.3, 24.2],
  ['height', 'girl', 0, 45.4, 49.1, 52.9], ['height', 'girl', 12, 68.9, 74, 79.2],
  ['height', 'girl', 24, 79.3, 85.7, 92.2], ['height', 'girl', 60, 99.9, 109.4, 118.9],
  ['height', 'boy', 0, 46.1, 49.9, 53.7], ['height', 'boy', 12, 71, 75.7, 80.5],
  ['height', 'boy', 24, 81, 87.1, 93.2], ['height', 'boy', 60, 100.7, 110, 119.2],
  ['head', 'girl', 0, 31.5, 33.9, 36.2], ['head', 'girl', 12, 42.2, 44.9, 47.6],
  ['head', 'girl', 24, 44.4, 47.2, 50], ['head', 'girl', 60, 47.1, 49.9, 52.8],
  ['head', 'boy', 0, 31.9, 34.5, 37], ['head', 'boy', 12, 43.5, 46.1, 48.6],
  ['head', 'boy', 24, 45.5, 48.3, 51], ['head', 'boy', 60, 47.7, 50.7, 53.7],
  ['bmi', 'girl', 0, 11.1, 13.3, 16.1], ['bmi', 'girl', 12, 13.8, 16.4, 19.6],
  ['bmi', 'girl', 24, 13.3, 15.7, 18.7], ['bmi', 'girl', 60, 12.7, 15.3, 18.8],
  ['bmi', 'boy', 0, 11.1, 13.4, 16.3], ['bmi', 'boy', 12, 14.4, 16.8, 19.8],
  ['bmi', 'boy', 24, 13.8, 16, 18.9], ['bmi', 'boy', 60, 12.9, 15.2, 18.3],
];

describe('WHO LMS tables reproduce published centiles', () => {
  it.each(ORACLE)('%s %s @ %d mo', (kind, sex, month, sdN2, sd0, sd2) => {
    const lms = WHO_LMS[kind][sex][month];
    expect(Math.abs(valueAtZ(lms, -2) - sdN2)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(valueAtZ(lms, 0) - sd0)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(valueAtZ(lms, 2) - sd2)).toBeLessThanOrEqual(0.1);
  });

  it('every table has 61 monthly rows', () => {
    for (const kind of ['weight', 'height', 'head', 'bmi'] as const)
      for (const sex of ['girl', 'boy'] as const)
        expect(WHO_LMS[kind][sex]).toHaveLength(61);
  });
});
