import { describe, expect, it } from 'vitest';

import {
  ageMonths,
  ageOrDueLabel,
  ageStr,
  ANCHOR_LABEL,
  anchorLabel,
  dayGroupLabel,
  dayKey,
  fmtAgo,
  fmtAgoShort,
  fmtClock,
  fmtDur,
  fmtElapsedClock,
  relDayLabel,
} from '@/lib/format';

const NOW = new Date(2026, 5, 22, 12, 0, 0).getTime(); // local noon
const M = 60000;

describe('fmtClock', () => {
  it('formats 24h time, zero-padded', () => {
    expect(fmtClock(new Date(2026, 0, 1, 9, 32).getTime())).toBe('09:32');
    expect(fmtClock(new Date(2026, 0, 1, 17, 5).getTime())).toBe('17:05');
    expect(fmtClock(new Date(2026, 0, 1, 0, 0).getTime())).toBe('00:00');
    expect(fmtClock(new Date(2026, 0, 1, 12, 0).getTime())).toBe('12:00');
  });
});

describe('fmtDur', () => {
  it('formats minutes and hours', () => {
    expect(fmtDur(20)).toBe('20 min');
    expect(fmtDur(60)).toBe('1h');
    expect(fmtDur(90)).toBe('1h 30m');
    expect(fmtDur(125)).toBe('2h 5m');
    expect(fmtDur(-5)).toBe('0 min');
  });
});

describe('fmtAgo', () => {
  it('formats relative past times', () => {
    expect(fmtAgo(NOW - 20 * 1000, NOW)).toBe('just now');
    expect(fmtAgo(NOW - 5 * M, NOW)).toBe('5m ago');
    expect(fmtAgo(NOW - 90 * M, NOW)).toBe('1h 30m ago');
    expect(fmtAgo(NOW - 120 * M, NOW)).toBe('2h ago');
    expect(fmtAgo(NOW - 26 * 60 * M, NOW)).toBe('1d 2h ago');
  });
});

describe('fmtAgoShort', () => {
  it('formats compact durations', () => {
    expect(fmtAgoShort(18)).toBe('18m');
    expect(fmtAgoShort(78)).toBe('1h18m');
    expect(fmtAgoShort(120)).toBe('2h');
    expect(fmtAgoShort(14824)).toBe('10d');
  });
});

describe('ageStr', () => {
  it('switches units by age', () => {
    expect(ageStr(NOW - 10 * 86400000, NOW)).toBe('10 days old');
    expect(ageStr(NOW - 21 * 86400000, NOW)).toBe('3 weeks old');
    expect(ageStr(NOW - 120 * 86400000, NOW)).toBe('3 months old');
  });
});

describe('relDayLabel / dayGroupLabel', () => {
  it('labels today vs earlier', () => {
    expect(relDayLabel(NOW - 12 * M, NOW)).toBe('Today, 12m ago');
    expect(relDayLabel(NOW - 26 * 3600000, NOW)).toBe('Yesterday');
    expect(dayGroupLabel(NOW - 5 * M, NOW)).toBe('Today');
    expect(dayGroupLabel(NOW - 26 * 3600000, NOW)).toBe('Yesterday');
  });

  it('calls only the previous CALENDAR day yesterday, however early it is now', () => {
    // 01:00, so "less than 48h ago" reaches back into the day before yesterday.
    const earlyMorning = new Date(2026, 5, 22, 1, 0, 0).getTime();
    expect(dayGroupLabel(new Date(2026, 5, 21, 20, 0, 0).getTime(), earlyMorning)).toBe('Yesterday');
    expect(dayGroupLabel(new Date(2026, 5, 20, 20, 0, 0).getTime(), earlyMorning)).toBe('20/06/2026');
  });

  it('crosses a month boundary', () => {
    const firstOfMonth = new Date(2026, 6, 1, 9, 0, 0).getTime();
    expect(dayGroupLabel(new Date(2026, 5, 30, 22, 0, 0).getTime(), firstOfMonth)).toBe('Yesterday');
  });
});

describe('dayKey', () => {
  it('is the same for two times on one local day and differs across midnight', () => {
    const morning = new Date(2026, 5, 22, 0, 30, 0).getTime();
    const evening = new Date(2026, 5, 22, 23, 30, 0).getTime();
    const nextDay = new Date(2026, 5, 23, 0, 30, 0).getTime();

    expect(dayKey(morning)).toBe(dayKey(evening));
    expect(dayKey(nextDay)).not.toBe(dayKey(morning));
  });

  it('pads month and day so keys sort chronologically as strings', () => {
    expect(dayKey(new Date(2026, 0, 5, 12, 0, 0).getTime())).toBe('2026-01-05');
  });

  it('agrees with dayGroupLabel about where a day starts', () => {
    // groupByDay keys its buckets with one and heads them with the other, so a
    // disagreement about the local midnight boundary would split or merge a day.
    const lateYesterday = new Date(2026, 5, 21, 23, 59, 0).getTime();
    const earlyToday = new Date(2026, 5, 22, 0, 1, 0).getTime();

    expect(dayKey(lateYesterday)).not.toBe(dayKey(earlyToday));
    expect(dayGroupLabel(lateYesterday, NOW)).toBe('Yesterday');
    expect(dayGroupLabel(earlyToday, NOW)).toBe('Today');
  });
});

describe('fmtElapsedClock', () => {
  it('formats M:SS and H:MM:SS', () => {
    expect(fmtElapsedClock(NOW - 65 * 1000, NOW)).toBe('1:05');
    expect(fmtElapsedClock(NOW - (3600 + 125) * 1000, NOW)).toBe('1:02:05');
  });
});

describe('ageMonths', () => {
  const DAY = 86400000;
  it('returns whole months elapsed since birth', () => {
    const birth = Date.parse('2025-01-01T00:00:00Z');
    expect(ageMonths(birth, birth)).toBe(0);
    expect(ageMonths(birth, birth + 200 * DAY)).toBe(6); // 200 / 30.4 = 6.5 -> 6
  });
  it('never returns negative for a future birth', () => {
    const birth = Date.parse('2025-01-01T00:00:00Z');
    expect(ageMonths(birth, birth - 10 * DAY)).toBe(0);
  });
});

describe('anchorLabel / ANCHOR_LABEL', () => {
  it('appends the short ago in parentheses when given minutes', () => {
    expect(anchorLabel(ANCHOR_LABEL.feedEnded, 120)).toBe('Feed ended (2h)');
    expect(anchorLabel(ANCHOR_LABEL.woke, 45)).toBe('Woke (45m)');
    expect(anchorLabel(ANCHOR_LABEL.feedStarted, 78)).toBe('Feed started (1h18m)');
    expect(anchorLabel(ANCHOR_LABEL.diaper, 0)).toBe('Diaper (0m)');
  });
  it('returns the base label unchanged when no ago is given', () => {
    expect(anchorLabel(ANCHOR_LABEL.diaper)).toBe('Diaper');
    expect(anchorLabel(ANCHOR_LABEL.woke)).toBe('Woke');
  });
});

describe('ageOrDueLabel', () => {
  const DAY = 86400000;
  const NOW = new Date(2026, 5, 15, 12, 0, 0).getTime(); // 15 June 2026, midday

  it('falls back to the plain age when the child is not expected', () => {
    expect(ageOrDueLabel(NOW - 3 * DAY, false, NOW)).toBe('3 days old');
    expect(ageOrDueLabel(NOW - 60 * DAY, false, NOW)).toBe('8 weeks old');
  });

  it('counts down in whole weeks when the due date is far out', () => {
    expect(ageOrDueLabel(NOW + 42 * DAY, true, NOW)).toBe('Due in 6 weeks');
  });

  it('uses weeks from 15 days out', () => {
    expect(ageOrDueLabel(NOW + 15 * DAY, true, NOW)).toBe('Due in 2 weeks');
  });

  it('uses days from 14 days out down to 2', () => {
    expect(ageOrDueLabel(NOW + 14 * DAY, true, NOW)).toBe('Due in 14 days');
    expect(ageOrDueLabel(NOW + 9 * DAY, true, NOW)).toBe('Due in 9 days');
    expect(ageOrDueLabel(NOW + 2 * DAY, true, NOW)).toBe('Due in 2 days');
  });

  it('says tomorrow at one day out', () => {
    expect(ageOrDueLabel(NOW + 1 * DAY, true, NOW)).toBe('Due tomorrow');
  });

  it('holds at a calm phrase on the day and after it', () => {
    expect(ageOrDueLabel(NOW, true, NOW)).toBe('Due any day now');
    expect(ageOrDueLabel(NOW - 1 * DAY, true, NOW)).toBe('Due any day now');
    expect(ageOrDueLabel(NOW - 30 * DAY, true, NOW)).toBe('Due any day now');
  });

  it('never counts up past the due date', () => {
    const label = ageOrDueLabel(NOW - 8 * DAY, true, NOW);
    expect(label).not.toMatch(/overdue|late|-/);
    expect(label).toBe('Due any day now');
  });
});
