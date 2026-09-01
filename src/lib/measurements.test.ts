import { describe, expect, it } from 'vitest';

import { MEAS_KINDS, MEAS_META, lowerLabel } from './measurements';

describe('lowerLabel', () => {
  it('lowercases an ordinary label', () => {
    expect(lowerLabel('Head circumference')).toBe('head circumference');
    expect(lowerLabel('Head circ.')).toBe('head circ.');
  });

  it('leaves an acronym uppercase', () => {
    expect(lowerLabel('BMI')).toBe('BMI');
  });

  it('never lowercases BMI for any of its labels', () => {
    expect(lowerLabel(MEAS_META.bmi.label)).toBe('BMI');
    expect(lowerLabel(MEAS_META.bmi.short)).toBe('BMI');
  });

  it('starts every other kind lowercase', () => {
    for (const kind of MEAS_KINDS.filter((k) => k !== 'bmi')) {
      expect(lowerLabel(MEAS_META[kind].label)[0]).toBe(MEAS_META[kind].label[0].toLowerCase());
    }
  });
});
