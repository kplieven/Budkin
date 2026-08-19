import { describe, expect, it } from 'vitest';

import { clampBirth, clampDueDate, midnight } from '@/lib/birthDate';

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

describe('clampDueDate', () => {
  const DAY = 86400000;

  it('lets a normal future due date through untouched', () => {
    const d = new Date(midnight() + 60 * DAY);
    expect(clampDueDate(String(d.getFullYear()), String(d.getMonth() + 1), String(d.getDate()))).toBe(
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(),
    );
  });

  it('leaves a past date alone, so an overdue pregnancy is not rewritten', () => {
    expect(clampDueDate('2020', '3', '15')).toBe(new Date(2020, 2, 15).getTime());
  });

  it('clamps a due date beyond 300 days to the 300 day ceiling', () => {
    // setDate, not added milliseconds: 300 days of ms crosses a DST boundary in
    // most timezones and lands at 23:00 or 01:00 rather than local midnight, which
    // would make this test fail only part of the year.
    const far = new Date();
    far.setHours(0, 0, 0, 0);
    far.setDate(far.getDate() + 900);

    const ceiling = new Date();
    ceiling.setHours(0, 0, 0, 0);
    ceiling.setDate(ceiling.getDate() + 300);

    const got = clampDueDate(String(far.getFullYear()), String(far.getMonth() + 1), String(far.getDate()));
    expect(got).toBe(ceiling.getTime());
  });

  it('keeps the 1900 lower bound', () => {
    expect(clampDueDate('1800', '5', '4')).toBe(new Date(1900, 4, 4).getTime());
  });

  it('clamps the day to the days in that month, honouring leap years', () => {
    expect(clampDueDate('2024', '2', '30')).toBe(new Date(2024, 1, 29).getTime());
  });

  it('clamps an out-of-range month into 1-12', () => {
    expect(clampDueDate('2020', '13', '9')).toBe(new Date(2020, 11, 9).getTime());
  });

  it('falls back to 1 January of the current year on unparseable input', () => {
    expect(clampDueDate('', 'abc', '')).toBe(new Date(new Date().getFullYear(), 0, 1).getTime());
  });
});
