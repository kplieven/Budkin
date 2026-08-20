import { describe, expect, it } from 'vitest';

import { addMonths, monthGrid, monthLabel, startOfDay, startOfMonth, withDate } from '@/lib/calendarMonth';

describe('startOfMonth / startOfDay', () => {
  it('drops the time and the day-of-month', () => {
    expect(startOfMonth(new Date(2026, 7, 20, 14, 47).getTime())).toBe(new Date(2026, 7, 1).getTime());
  });

  it('keeps the day but drops the time', () => {
    expect(startOfDay(new Date(2026, 7, 20, 14, 47).getTime())).toBe(new Date(2026, 7, 20).getTime());
  });
});

describe('addMonths', () => {
  it('steps back and forward', () => {
    const aug = new Date(2026, 7, 1).getTime();
    expect(addMonths(aug, -1)).toBe(new Date(2026, 6, 1).getTime());
    expect(addMonths(aug, 1)).toBe(new Date(2026, 8, 1).getTime());
  });

  it('crosses the year boundary', () => {
    expect(addMonths(new Date(2026, 0, 1).getTime(), -1)).toBe(new Date(2025, 11, 1).getTime());
  });

  it('does not roll a long month over its short neighbour', () => {
    expect(addMonths(new Date(2026, 0, 31, 9, 0).getTime(), 1)).toBe(new Date(2026, 1, 1).getTime());
  });
});

describe('monthGrid', () => {
  it('always returns six whole weeks', () => {
    expect(monthGrid(new Date(2026, 1, 1).getTime())).toHaveLength(42);
  });

  it('starts on the Monday on or before the 1st', () => {
    // 1 Aug 2026 is a Saturday, so the grid opens on Monday 27 July.
    const cells = monthGrid(new Date(2026, 7, 1).getTime());
    expect(cells[0].ms).toBe(new Date(2026, 6, 27).getTime());
    expect(cells[0].inMonth).toBe(false);
    expect(new Date(cells[0].ms).getDay()).toBe(1);
  });

  it('opens on the 1st when the month itself starts on a Monday', () => {
    // 1 June 2026 is a Monday: no leading pad.
    const cells = monthGrid(new Date(2026, 5, 15).getTime());
    expect(cells[0].ms).toBe(new Date(2026, 5, 1).getTime());
    expect(cells[0].inMonth).toBe(true);
  });

  it('marks exactly the days of the month as in-month', () => {
    const cells = monthGrid(new Date(2026, 7, 20).getTime());
    const inMonth = cells.filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(31);
    expect(inMonth[0].day).toBe(1);
    expect(inMonth[30].day).toBe(31);
  });

  it('handles a leap February', () => {
    expect(monthGrid(new Date(2024, 1, 10).getTime()).filter((c) => c.inMonth)).toHaveLength(29);
  });

  it('runs consecutive days with no gaps or repeats', () => {
    const cells = monthGrid(new Date(2026, 2, 1).getTime()); // March, over a DST change
    for (let i = 1; i < cells.length; i++) {
      const prev = new Date(cells[i - 1].ms);
      expect(new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1).getTime()).toBe(cells[i].ms);
    }
  });
});

describe('monthLabel', () => {
  it('names the month and year', () => {
    expect(monthLabel(new Date(2026, 7, 1).getTime())).toBe('August 2026');
  });
});

describe('withDate', () => {
  it('moves the date and keeps the time of day', () => {
    const t = new Date(2026, 7, 20, 14, 47, 30, 250).getTime();
    expect(withDate(t, new Date(2026, 3, 2).getTime())).toBe(new Date(2026, 3, 2, 14, 47, 30, 250).getTime());
  });

  it('ignores the time on the day it is given', () => {
    const t = new Date(2026, 7, 20, 6, 5).getTime();
    expect(withDate(t, new Date(2026, 3, 2, 23, 59).getTime())).toBe(new Date(2026, 3, 2, 6, 5).getTime());
  });
});
