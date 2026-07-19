import { describe, expect, it } from 'vitest';

import { clampBirth, midnight } from '@/lib/birthDate';

describe('midnight', () => {
  it('returns local midnight today', () => {
    const d = new Date(midnight());
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
    expect(d.toDateString()).toBe(new Date().toDateString());
  });
});

describe('clampBirth', () => {
  it('converts a valid past date to local midnight', () => {
    expect(clampBirth('2024', '3', '15')).toBe(new Date(2024, 2, 15).getTime());
  });

  it('never returns a date in the future', () => {
    const thisYear = String(new Date().getFullYear());
    expect(clampBirth(thisYear, '12', '31')).toBe(midnight());
  });

  it('clamps the year to the current year', () => {
    expect(clampBirth('2999', '1', '1')).toBe(new Date(new Date().getFullYear(), 0, 1).getTime());
  });

  it('clamps the year up to 1900', () => {
    expect(clampBirth('1800', '5', '4')).toBe(new Date(1900, 4, 4).getTime());
  });

  it('clamps the day to the days in that month, honouring leap years', () => {
    expect(clampBirth('2024', '2', '30')).toBe(new Date(2024, 1, 29).getTime());
    expect(clampBirth('2023', '2', '30')).toBe(new Date(2023, 1, 28).getTime());
  });

  it('clamps an out-of-range month into 1-12', () => {
    expect(clampBirth('2020', '13', '9')).toBe(new Date(2020, 11, 9).getTime());
    expect(clampBirth('2020', '0', '9')).toBe(new Date(2020, 0, 9).getTime());
  });

  it('falls back to 1 January of the current year on unparseable input', () => {
    expect(clampBirth('', 'abc', '')).toBe(new Date(new Date().getFullYear(), 0, 1).getTime());
  });
});
