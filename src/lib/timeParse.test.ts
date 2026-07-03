import { describe, expect, it } from 'vitest';

import { parseClockInput, parseDurationInput, resolveClock } from '@/lib/timeParse';

describe('parseClockInput', () => {
  it('parses bare hours', () => {
    expect(parseClockInput('9')).toEqual({ h: 9, m: 0, explicit12: undefined });
    expect(parseClockInput('14')).toEqual({ h: 14, m: 0, explicit12: undefined });
    expect(parseClockInput('0')).toEqual({ h: 0, m: 0, explicit12: undefined });
  });
  it('parses two digits over 23 as hour + tens of minutes', () => {
    expect(parseClockInput('93')).toEqual({ h: 9, m: 30, explicit12: undefined });
  });
  it('parses 3-4 digit clock strings', () => {
    expect(parseClockInput('930')).toEqual({ h: 9, m: 30, explicit12: undefined });
    expect(parseClockInput('0930')).toEqual({ h: 9, m: 30, explicit12: undefined });
    expect(parseClockInput('1447')).toEqual({ h: 14, m: 47, explicit12: undefined });
  });
  it('parses colon form', () => {
    expect(parseClockInput('2:47')).toEqual({ h: 2, m: 47, explicit12: undefined });
    expect(parseClockInput('14:47')).toEqual({ h: 14, m: 47, explicit12: undefined });
  });
  it('parses am/pm suffixes', () => {
    expect(parseClockInput('247p')).toEqual({ h: 2, m: 47, explicit12: 'pm' });
    expect(parseClockInput('9:15 am')).toEqual({ h: 9, m: 15, explicit12: 'am' });
    expect(parseClockInput('12pm')).toEqual({ h: 12, m: 0, explicit12: 'pm' });
  });
  it('rejects invalid input', () => {
    expect(parseClockInput('')).toBeNull();
    expect(parseClockInput('abc')).toBeNull();
    expect(parseClockInput('2470')).toBeNull(); // hour 24
    expect(parseClockInput('1299')).toBeNull(); // minute 99
    expect(parseClockInput('13pm')).toBeNull(); // 12h suffix with 24h hour
    expect(parseClockInput('1:5')).toBeNull(); // colon needs two minute digits
  });
});

describe('resolveClock (most-recent-match)', () => {
  // A fixed local reference day; times built with the local Date ctor to stay
  // timezone-independent.
  const day = (h: number, m = 0) => new Date(2026, 5, 15, h, m).getTime();
  const parse = (s: string) => parseClockInput(s)!;

  it('ambiguous input picks the latest match not in the future (PM today)', () => {
    expect(resolveClock(parse('2:47'), day(12), day(15))).toBe(day(14, 47));
  });
  it('ambiguous input falls back to AM when PM would be future', () => {
    expect(resolveClock(parse('2:47'), day(12), day(14))).toBe(day(2, 47));
  });
  it('ambiguous input on a past day picks PM', () => {
    const nextDayNoon = new Date(2026, 5, 16, 12).getTime();
    expect(resolveClock(parse('2:47'), day(12), nextDayNoon)).toBe(day(14, 47));
  });
  it('all candidates future clamps to now', () => {
    expect(resolveClock(parse('2:47'), day(12), day(1))).toBe(day(1));
  });
  it('explicit pm is honored', () => {
    expect(resolveClock(parse('247p'), day(12), day(15))).toBe(day(14, 47));
  });
  it('explicit am is honored even when pm would be more recent', () => {
    expect(resolveClock(parse('2:47am'), day(12), day(15))).toBe(day(2, 47));
  });
  it('24h input is unambiguous', () => {
    expect(resolveClock(parse('1447'), day(12), day(15))).toBe(day(14, 47));
    expect(resolveClock(parse('0'), day(12), day(15))).toBe(day(0));
  });
  it('12 maps to noon/midnight', () => {
    expect(resolveClock(parse('12:30'), day(12), day(15))).toBe(day(12, 30));
    expect(resolveClock(parse('12:30am'), day(12), day(15))).toBe(day(0, 30));
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
