import { describe, expect, it } from 'vitest';

import {
  addDays,
  addMonths,
  atReminderHour,
  desiredScheduled,
  diffScheduled,
  REMINDER_PREFIX,
  type ReminderPrefs,
  type ScheduleInput,
} from '@/notifications/scheduled';
import type { Child } from '@/types/models';

/** Local-time construction, so the 09:00 assertions hold in any timezone. */
const at = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime();

const prefs = (over: Partial<ReminderPrefs> = {}): ReminderPrefs => ({
  dueDateReminders: true,
  staleTimerReminders: true,
  ageMilestones: true,
  pumpingReminders: false,
  pumpingIntervalMin: 180,
  pumpingEnabledAt: null,
  ...over,
});

const child = (over: Partial<Child> = {}): Child => ({
  id: 'c1',
  first: 'Rowan',
  last: '',
  birth: at(2026, 9, 1),
  color: '#208AEF',
  ...over,
});

const input = (over: Partial<ScheduleInput> = {}): ScheduleInput => ({
  children: [],
  timers: [],
  prefs: prefs(),
  lastPumpAt: null,
  ...over,
});

describe('atReminderHour', () => {
  it('moves any instant to 09:00 on its own calendar day', () => {
    expect(atReminderHour(at(2026, 9, 1, 23))).toBe(at(2026, 9, 1, 9));
    expect(atReminderHour(at(2026, 9, 1, 2))).toBe(at(2026, 9, 1, 9));
  });
});

describe('addDays / addMonths', () => {
  it('adds days by calendar, not by fixed milliseconds', () => {
    expect(addDays(at(2026, 9, 8), -7)).toBe(at(2026, 9, 1));
  });
  it('clamps a month addition to the last day of a short month', () => {
    // 31 January plus three months has no 31 April, so it lands on the 30th.
    expect(addMonths(at(2026, 1, 31), 3)).toBe(at(2026, 4, 30));
  });
  it('adds whole months when the day exists', () => {
    expect(addMonths(at(2026, 1, 15), 3)).toBe(at(2026, 4, 15));
  });
});

describe('desiredScheduled: due date', () => {
  const expecting = child({ expected: true, birth: at(2026, 9, 1) });

  it('schedules a lead-up seven days out and one on the day, both at 09:00', () => {
    const out = desiredScheduled(input({ children: [expecting] }), at(2026, 8, 1));
    expect(out.map((n) => n.fireAt)).toEqual([at(2026, 8, 25, 9), at(2026, 9, 1, 9)]);
    expect(out[0].title).toBe('Rowan is due next week');
    expect(out[1].title).toBe("Today is Rowan's due date");
    expect(out.every((n) => n.identifier.startsWith(REMINDER_PREFIX))).toBe(true);
    expect(out.every((n) => n.data.url === '/')).toBe(true);
  });

  it('encodes the fire time in the identifier so editing the due date reschedules', () => {
    const a = desiredScheduled(input({ children: [expecting] }), at(2026, 8, 1));
    const moved = child({ expected: true, birth: at(2026, 9, 8) });
    const b = desiredScheduled(input({ children: [moved] }), at(2026, 8, 1));
    expect(a[1].identifier).not.toBe(b[1].identifier);
  });

  it('skips the lead-up when the due date is entered inside seven days', () => {
    const out = desiredScheduled(input({ children: [expecting] }), at(2026, 8, 28));
    expect(out).toHaveLength(1);
    expect(out[0].fireAt).toBe(at(2026, 9, 1, 9));
  });

  it('schedules nothing once the due date has passed', () => {
    const out = desiredScheduled(input({ children: [expecting] }), at(2026, 9, 2));
    expect(out).toEqual([]);
  });

  it('drops due reminders once the birth is confirmed', () => {
    const born = child({ expected: false, birth: at(2026, 9, 1) });
    const out = desiredScheduled(input({ children: [born] }), at(2026, 8, 1));
    expect(out.filter((n) => n.kind === 'due')).toEqual([]);
  });

  it('drops due reminders when the pref is off', () => {
    const out = desiredScheduled(
      input({ children: [expecting], prefs: prefs({ dueDateReminders: false }) }),
      at(2026, 8, 1),
    );
    expect(out).toEqual([]);
  });

  it('covers every expecting child, not only the first', () => {
    const second = child({ id: 'c2', first: 'Wren', expected: true, birth: at(2026, 10, 1) });
    const out = desiredScheduled(input({ children: [expecting, second] }), at(2026, 8, 1));
    expect(out).toHaveLength(4);
  });
});

describe('diffScheduled', () => {
  const n = {
    identifier: `${REMINDER_PREFIX}due:c1:day:1`,
    kind: 'due' as const,
    title: 'Today is Rowan\'s due date',
    body: 'Tap when your baby arrives.',
    fireAt: 1,
    data: { url: '/' },
  };

  it('schedules what is desired but not yet pending', () => {
    expect(diffScheduled([], [n])).toEqual({ toSchedule: [n], toCancel: [] });
  });

  it('cancels what is pending but no longer desired', () => {
    const existing = [{ identifier: n.identifier, title: n.title, body: n.body }];
    expect(diffScheduled(existing, [])).toEqual({ toSchedule: [], toCancel: [n.identifier] });
  });

  it('does nothing when pending already matches', () => {
    const existing = [{ identifier: n.identifier, title: n.title, body: n.body }];
    expect(diffScheduled(existing, [n])).toEqual({ toSchedule: [], toCancel: [] });
  });

  it('reschedules when the title changed, e.g. the child was renamed', () => {
    const existing = [{ identifier: n.identifier, title: 'Today is Wren\'s due date', body: n.body }];
    expect(diffScheduled(existing, [n]).toSchedule).toEqual([n]);
  });

  it('reschedules when only the body changed', () => {
    const existing = [{ identifier: n.identifier, title: n.title, body: 'Something else.' }];
    expect(diffScheduled(existing, [n]).toSchedule).toEqual([n]);
  });

  it('never cancels an identifier it does not own', () => {
    const existing = [{ identifier: 'some-timer-uuid', title: 'Rowan · Sleep', body: 'Started 14:45' }];
    expect(diffScheduled(existing, [])).toEqual({ toSchedule: [], toCancel: [] });
  });
});
