import { describe, expect, it } from 'vitest';

import { parseClockInput, parseDurationInput, resolveClock } from '@/lib/timeParse';

describe('parseClockInput (24h)', () => {
  it('parses bare hours', () => {
    expect(parseClockInput('9')).toEqual({ h: 9, m: 0 });
    expect(parseClockInput('14')).toEqual({ h: 14, m: 0 });
    expect(parseClockInput('0')).toEqual({ h: 0, m: 0 });
    expect(parseClockInput('23')).toEqual({ h: 23, m: 0 });
  });
  it('parses 3-4 digit clock strings', () => {
    expect(parseClockInput('930')).toEqual({ h: 9, m: 30 });
    expect(parseClockInput('0930')).toEqual({ h: 9, m: 30 });
    expect(parseClockInput('1447')).toEqual({ h: 14, m: 47 });
    expect(parseClockInput('2359')).toEqual({ h: 23, m: 59 });
  });
  it('parses colon form', () => {
    expect(parseClockInput('2:47')).toEqual({ h: 2, m: 47 });
    expect(parseClockInput('14:47')).toEqual({ h: 14, m: 47 });
  });
  it('rejects invalid input', () => {
    expect(parseClockInput('')).toBeNull();
    expect(parseClockInput('abc')).toBeNull();
    expect(parseClockInput('24')).toBeNull(); // hour 24
    expect(parseClockInput('2470')).toBeNull(); // hour 24
    expect(parseClockInput('1299')).toBeNull(); // minute 99
    expect(parseClockInput('93')).toBeNull(); // hour 93 — must type 930 for 09:30
    expect(parseClockInput('1:5')).toBeNull(); // colon needs two minute digits
  });
});

describe('resolveClock', () => {
  const day = (h: number, m = 0) => new Date(2026, 5, 15, h, m).getTime();
  const parse = (s: string) => parseClockInput(s)!;

  it('places the time on the given day', () => {
    expect(resolveClock(parse('1447'), day(12), day(20))).toBe(day(14, 47));
    expect(resolveClock(parse('9'), day(12), day(20))).toBe(day(9));
  });
  it('resolves on a past day regardless of now', () => {
    const nextDayNoon = new Date(2026, 5, 16, 12).getTime();
    expect(resolveClock(parse('1447'), day(12), nextDayNoon)).toBe(day(14, 47));
  });
  it('rolls a future time back to the previous day (most recent occurrence)', () => {
    // day context is today at 12:00, now is 10:00 → 14:47 is future → yesterday
    const yesterday1447 = new Date(2026, 5, 14, 14, 47).getTime();
    expect(resolveClock(parse('1447'), day(12), day(10))).toBe(yesterday1447);
  });
});

describe('parseDurationInput', () => {
  it('parses plain minutes', () => {
    expect(parseDurationInput('37')).toBe(37);
    expect(parseDurationInput('95')).toBe(95);
    expect(parseDurationInput('45m')).toBe(45);
  });
  it('parses h:mm and XhYY forms', () => {
    expect(parseDurationInput('1:35')).toBe(95);
    expect(parseDurationInput('1h35')).toBe(95);
    expect(parseDurationInput('1h')).toBe(60);
    expect(parseDurationInput('2h05m')).toBe(125);
  });
  it('rejects invalid or zero durations', () => {
    expect(parseDurationInput('')).toBeNull();
    expect(parseDurationInput('0')).toBeNull();
    expect(parseDurationInput('abc')).toBeNull();
    expect(parseDurationInput('1:99')).toBeNull();
  });
});
