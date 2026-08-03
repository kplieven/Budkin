import { describe, expect, it } from 'vitest';

import { ageMonths } from '@/lib/format';
import { overdueUnlogged } from '@/lib/milestones';
import {
  addDays,
  addMonths,
  AGE_HORIZON_MONTHS,
  AGE_STEPS,
  atReminderHour,
  TREATMENT_AHEAD,
  desiredScheduled,
  diffScheduled,
  PUMP_AHEAD,
  REMINDER_PREFIX,
  staleDelivered,
  STALE_AFTER_MIN,
  type ReminderPrefs,
  type ScheduleInput,
} from '@/notifications/scheduled';
import type { Child, Treatment, Timer } from '@/types/models';

/** Local-time construction, so the 09:00 assertions hold in any timezone. */
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();

const prefs = (over: Partial<ReminderPrefs> = {}): ReminderPrefs => ({
  dueDateReminders: true,
  staleTimerReminders: true,
  ageMilestones: true,
  pumpingReminders: false,
  pumpingIntervalMin: 180,
  pumpingEnabledAt: null,
  napSuggestions: false,
  treatmentReminders: false,
  treatmentRemindersEnabledAt: null,
  milestoneCatchUp: false,
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
  lastSleepEndByChild: {},
  asleepChildIds: {},
  selectedChildId: 'c1',
  treatments: [],
  treatmentDoses: {},
  reachedMilestoneKeysByChild: {},
  answeredMilestoneKeysByChild: {},
  ...over,
});

const timer = (over: Partial<Timer> = {}): Timer => ({
  id: 't1',
  childId: 'c1',
  activity: 'sleep',
  name: 'Sleep',
  start: at(2026, 9, 1, 20),
  saveAs: 'sleep',
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
    expect(out.every((n) => n.data.url === '/?child=c1')).toBe(true);
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

  it('does not schedule the lead-up reminder at the exact instant it is due to fire', () => {
    const out = desiredScheduled(input({ children: [expecting] }), at(2026, 8, 25, 9));
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Today is Rowan's due date");
  });

  it('schedules nothing once the due date has passed', () => {
    const out = desiredScheduled(input({ children: [expecting] }), at(2026, 9, 2));
    expect(out).toEqual([]);
  });

  it('does not schedule the day-of reminder at the exact instant it is due to fire', () => {
    const out = desiredScheduled(input({ children: [expecting] }), at(2026, 9, 1, 9));
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

describe('desiredScheduled: stale timers', () => {
  const born = child({ birth: at(2020, 1, 1) });

  it('schedules one alert per running timer at start plus its threshold', () => {
    const out = desiredScheduled(
      input({ children: [born], timers: [timer()], prefs: prefs({ ageMilestones: false }) }),
      at(2026, 9, 1, 21),
    );
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('stale');
    // Non-null assertion: the Record is typed `number | null` because point
    // activities have no threshold, but sleep always has one.
    expect(out[0].fireAt).toBe(at(2026, 9, 1, 20) + STALE_AFTER_MIN.sleep! * 60_000);
    expect(out[0].title).toBe('Rowan · Sleep');
    expect(out[0].body).toBe('Running for 14 hours. Still going?');
    expect(out[0].data.url).toBe('/timers?child=c1');
  });

  it('names no child for a timer nobody owns', () => {
    // `childId` is optional on Timer, because the persisted payloads are cast and
    // never validated, and an absent one means "not attributable" rather than
    // "the selected child". So the tap carries no child either, and lands on the
    // current selection. Same permanent shape as a reminder scheduled before the
    // parameter existed.
    const out = desiredScheduled(
      input({ children: [born], timers: [timer({ childId: undefined })], prefs: prefs({ ageMilestones: false }) }),
      at(2026, 9, 1, 21),
    );
    expect(out[0].data.url).toBe('/timers');
  });

  it('uses the per-activity threshold', () => {
    expect(STALE_AFTER_MIN.tummy).toBe(45);
    expect(STALE_AFTER_MIN.pumping).toBe(120);
    expect(STALE_AFTER_MIN.feeding).toBe(180);
    expect(STALE_AFTER_MIN.sleep).toBe(840);
  });

  it('phrases sub-hour thresholds in minutes', () => {
    const out = desiredScheduled(
      input({
        children: [born],
        timers: [timer({ saveAs: 'tummy', activity: 'tummy' })],
        prefs: prefs({ ageMilestones: false }),
      }),
      at(2026, 9, 1, 20),
    );
    expect(out[0].body).toBe('Running for 45 minutes. Still going?');
  });

  it('encodes the fire time, so editing a running timer\'s start reschedules', () => {
    const a = desiredScheduled(
      input({ children: [born], timers: [timer()], prefs: prefs({ ageMilestones: false }) }),
      at(2026, 9, 1, 21),
    );
    const b = desiredScheduled(
      input({
        children: [born],
        timers: [timer({ start: at(2026, 9, 1, 21) })],
        prefs: prefs({ ageMilestones: false }),
      }),
      at(2026, 9, 1, 21),
    );
    // Title and body are identical, so only the identifier can carry the change.
    expect(a[0].title).toBe(b[0].title);
    expect(a[0].body).toBe(b[0].body);
    expect(a[0].identifier).not.toBe(b[0].identifier);
  });

  it('does not schedule a timer already past its threshold', () => {
    const out = desiredScheduled(
      input({ children: [born], timers: [timer()], prefs: prefs({ ageMilestones: false }) }),
      at(2026, 9, 2, 12),
    );
    expect(out).toEqual([]);
  });

  it('does not schedule a stale alert at the exact instant its threshold fires', () => {
    const fireAt = timer().start + STALE_AFTER_MIN.sleep! * 60_000;
    const out = desiredScheduled(
      input({ children: [born], timers: [timer()], prefs: prefs({ ageMilestones: false }) }),
      fireAt,
    );
    expect(out).toEqual([]);
  });

  it('omits a point activity that cannot run a timer', () => {
    const out = desiredScheduled(
      input({
        children: [born],
        timers: [timer({ saveAs: 'diaper', activity: 'diaper' })],
        prefs: prefs({ ageMilestones: false }),
      }),
      at(2026, 9, 1, 20),
    );
    expect(out).toEqual([]);
  });

  it('falls back to the bare label when the timer has no matching child', () => {
    const out = desiredScheduled(
      input({ children: [], timers: [timer({ childId: 'gone' })], prefs: prefs({ ageMilestones: false }) }),
      at(2026, 9, 1, 21),
    );
    expect(out[0].title).toBe('Sleep');
  });

  it('drops stale alerts when the pref is off', () => {
    const out = desiredScheduled(
      input({
        children: [born],
        timers: [timer()],
        prefs: prefs({ staleTimerReminders: false, ageMilestones: false }),
      }),
      at(2026, 9, 1, 21),
    );
    expect(out).toEqual([]);
  });
});

describe('desiredScheduled: age milestones', () => {
  const noOthers = prefs({ dueDateReminders: false, staleTimerReminders: false });

  it('uses the 1w / 1m / 3m / 6m / 9m cadence and nothing clinical', () => {
    expect(AGE_STEPS.map((s) => s.slug)).toEqual(['1w', '1m', '3m', '6m', '9m']);
  });

  it('schedules every upcoming step at 09:00', () => {
    const born = child({ birth: at(2026, 9, 1) });
    const out = desiredScheduled(input({ children: [born], prefs: noOthers }), at(2026, 9, 1, 12));
    expect(out.map((n) => n.fireAt)).toEqual([
      at(2026, 9, 8, 9),
      at(2026, 10, 1, 9),
      at(2026, 12, 1, 9),
      at(2027, 3, 1, 9),
      at(2027, 6, 1, 9),
      at(2027, 9, 1, 9),
    ]);
    expect(out[0].title).toBe('Rowan is one week old today.');
    expect(out[2].title).toBe('Rowan is three months old today.');
    expect(out[5].title).toBe('Happy first birthday, Rowan.');
    expect(out.every((n) => n.data.url === '/history?child=c1')).toBe(true);
  });

  it('clamps a month step to the last day of a short month', () => {
    const born = child({ birth: at(2026, 1, 31) });
    const out = desiredScheduled(input({ children: [born], prefs: noOthers }), at(2026, 1, 31, 12));
    // 31 January plus three months has no 31 April.
    expect(out.find((n) => n.identifier.includes(':3m:'))?.fireAt).toBe(at(2026, 4, 30, 9));
  });

  it('drops steps that have already passed', () => {
    const born = child({ birth: at(2026, 1, 1) });
    const out = desiredScheduled(input({ children: [born], prefs: noOthers }), at(2026, 5, 1));
    expect(out.map((n) => n.identifier.split(':')[3])).toEqual(['6m', '9m', '1y']);
  });

  it('schedules only inside the rolling horizon', () => {
    expect(AGE_HORIZON_MONTHS).toBe(12);
    const born = child({ birth: at(2026, 9, 1) });
    const out = desiredScheduled(input({ children: [born], prefs: noOthers }), at(2026, 9, 1, 12));
    const horizon = addMonths(at(2026, 9, 1, 12), AGE_HORIZON_MONTHS);
    expect(out.every((n) => n.fireAt <= horizon)).toBe(true);
  });

  it('keeps going with yearly birthdays past the first', () => {
    const born = child({ birth: at(2024, 9, 1) });
    const out = desiredScheduled(input({ children: [born], prefs: noOthers }), at(2026, 1, 1));
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('Happy 2nd birthday, Rowan.');
    expect(out[0].fireAt).toBe(at(2026, 9, 1, 9));
  });

  it('ordinalises third and later birthdays correctly', () => {
    const born = child({ birth: at(2023, 9, 1) });
    const out = desiredScheduled(input({ children: [born], prefs: noOthers }), at(2026, 1, 1));
    expect(out[0].title).toBe('Happy 3rd birthday, Rowan.');
  });

  it('excludes an expecting child, whose birth field holds a due date', () => {
    const expecting = child({ expected: true, birth: at(2026, 9, 1) });
    const out = desiredScheduled(input({ children: [expecting], prefs: noOthers }), at(2026, 8, 1));
    expect(out).toEqual([]);
  });

  it('drops age milestones when the pref is off', () => {
    const born = child({ birth: at(2026, 9, 1) });
    const out = desiredScheduled(
      input({ children: [born], prefs: prefs({ dueDateReminders: false, staleTimerReminders: false, ageMilestones: false }) }),
      at(2026, 9, 1, 12),
    );
    expect(out).toEqual([]);
  });
});

describe('desiredScheduled: pumping', () => {
  const only = (over: Partial<ReminderPrefs>) =>
    prefs({ dueDateReminders: false, staleTimerReminders: false, ageMilestones: false, ...over });

  it('schedules a run of occurrences on the interval grid from the last pump', () => {
    const out = desiredScheduled(
      input({
        prefs: only({ pumpingReminders: true, pumpingIntervalMin: 180, pumpingEnabledAt: at(2026, 9, 1, 0) }),
        lastPumpAt: at(2026, 9, 1, 6),
      }),
      at(2026, 9, 1, 7),
    );
    expect(out).toHaveLength(PUMP_AHEAD);
    expect(out[0].fireAt).toBe(at(2026, 9, 1, 9));
    expect(out[1].fireAt).toBe(at(2026, 9, 1, 12));
    expect(out[0].title).toBe('Time to pump');
    expect(out[0].body).toBe('Tap to log a session.');
    // Deliberately childless, unlike every other kind: pumping is parent-side,
    // scheduled once for the device rather than per child, so there is nobody
    // for the tap to select.
    expect(out[0].data.url).toBe('/timers');
  });

  it('re-anchors when a newer pump is logged', () => {
    const a = desiredScheduled(
      input({
        prefs: only({ pumpingReminders: true, pumpingIntervalMin: 180, pumpingEnabledAt: at(2026, 9, 1, 0) }),
        lastPumpAt: at(2026, 9, 1, 6),
      }),
      at(2026, 9, 1, 7),
    );
    const b = desiredScheduled(
      input({
        prefs: only({ pumpingReminders: true, pumpingIntervalMin: 180, pumpingEnabledAt: at(2026, 9, 1, 0) }),
        lastPumpAt: at(2026, 9, 1, 7),
      }),
      at(2026, 9, 1, 7),
    );
    expect(b[0].fireAt).toBe(at(2026, 9, 1, 10));
    expect(a[0].identifier).not.toBe(b[0].identifier);
  });

  it('falls back to the enable time when nothing has been pumped yet', () => {
    const out = desiredScheduled(
      input({
        prefs: only({ pumpingReminders: true, pumpingIntervalMin: 180, pumpingEnabledAt: at(2026, 9, 1, 6) }),
        lastPumpAt: null,
      }),
      at(2026, 9, 1, 7),
    );
    expect(out[0].fireAt).toBe(at(2026, 9, 1, 9));
  });

  it('re-enters the grid on phase when every occurrence has already passed', () => {
    // Enabled two days ago, app never opened since. Naively scheduling from the
    // anchor would produce only past instants and therefore nothing at all.
    const out = desiredScheduled(
      input({
        prefs: only({ pumpingReminders: true, pumpingIntervalMin: 180, pumpingEnabledAt: at(2026, 9, 1, 6) }),
        lastPumpAt: null,
      }),
      at(2026, 9, 3, 7),
    );
    expect(out).toHaveLength(PUMP_AHEAD);
    expect(out.every((n) => n.fireAt > at(2026, 9, 3, 7))).toBe(true);
    expect(out[0].fireAt).toBe(at(2026, 9, 3, 9));
  });

  it('schedules nothing while the pref is off', () => {
    const out = desiredScheduled(
      input({
        prefs: only({ pumpingReminders: false, pumpingEnabledAt: at(2026, 9, 1, 6) }),
        lastPumpAt: at(2026, 9, 1, 6),
      }),
      at(2026, 9, 1, 7),
    );
    expect(out).toEqual([]);
  });

  it('schedules nothing when there is no anchor at all', () => {
    const out = desiredScheduled(
      input({ prefs: only({ pumpingReminders: true, pumpingEnabledAt: null }), lastPumpAt: null }),
      at(2026, 9, 1, 7),
    );
    expect(out).toEqual([]);
  });

  it('keeps the same identifier for an occurrence while now advances toward it', () => {
    // The grid stays anchored, so an identifier must depend only on the anchor
    // and the occurrence number, never on `now`. Otherwise every reconcile
    // (e.g. a bare clock tick) would look like a change and re-trigger a
    // cancel-and-reschedule of the whole pumping set.
    const pumpPrefs = only({ pumpingReminders: true, pumpingIntervalMin: 180, pumpingEnabledAt: at(2026, 9, 1, 0) });
    const a = desiredScheduled(
      input({ prefs: pumpPrefs, lastPumpAt: at(2026, 9, 1, 6) }),
      at(2026, 9, 1, 7),
    );
    const b = desiredScheduled(
      input({ prefs: pumpPrefs, lastPumpAt: at(2026, 9, 1, 6) }),
      at(2026, 9, 1, 8),
    );
    expect(a[0].fireAt).toBe(b[0].fireAt);
    expect(a[0].identifier).toBe(b[0].identifier);
  });

  it('changes the identifier when the interval changes, so a moved cadence reschedules', () => {
    // Same anchor, same occurrence number (both are the first occurrence), but a
    // different interval means a different fire time. The title and body of a
    // pumping alert never change, so the identifier is the only thing that can
    // tell the diff an occurrence moved.
    const anchor = at(2026, 9, 1, 0);
    const now = at(2026, 9, 1, 1);
    const a = desiredScheduled(
      input({
        prefs: only({ pumpingReminders: true, pumpingIntervalMin: 180, pumpingEnabledAt: anchor }),
        lastPumpAt: null,
      }),
      now,
    );
    const b = desiredScheduled(
      input({
        prefs: only({ pumpingReminders: true, pumpingIntervalMin: 120, pumpingEnabledAt: anchor }),
        lastPumpAt: null,
      }),
      now,
    );
    expect(a[0].fireAt).not.toBe(b[0].fireAt);
    expect(a[0].identifier).not.toBe(b[0].identifier);
  });

  it('skips a candidate that lands exactly on now, and still produces a full PUMP_AHEAD run', () => {
    // (now - anchor) % interval === 0 puts the first candidate exactly on `now`,
    // which `if (fireAt <= now) continue;` skips. The loop bound is one wider
    // than PUMP_AHEAD specifically to compensate for that one skip, so this
    // pins that the compensation still produces a full run.
    const anchor = at(2026, 9, 1, 0);
    const now = at(2026, 9, 1, 3); // anchor plus exactly one 180-minute interval
    const out = desiredScheduled(
      input({
        prefs: only({ pumpingReminders: true, pumpingIntervalMin: 180, pumpingEnabledAt: anchor }),
        lastPumpAt: null,
      }),
      now,
    );
    expect(out).toHaveLength(PUMP_AHEAD);
    expect(out.some((o) => o.fireAt === now)).toBe(false);
    expect(out[0].fireAt).toBe(at(2026, 9, 1, 6));
    expect(out[out.length - 1].fireAt).toBe(at(2026, 9, 2, 3));
  });

  it('schedules nothing while a pumping timer is running', () => {
    const out = desiredScheduled(
      input({
        prefs: only({ pumpingReminders: true, pumpingIntervalMin: 180, pumpingEnabledAt: at(2026, 9, 1, 0) }),
        lastPumpAt: at(2026, 9, 1, 6),
        timers: [timer({ id: 'p1', activity: 'pumping', saveAs: 'pumping', start: at(2026, 9, 1, 6, 50) })],
      }),
      at(2026, 9, 1, 7),
    );
    expect(out).toEqual([]);
  });

  it('suppresses on saveAs, so a quick timer repointed to pumping still counts', () => {
    const out = desiredScheduled(
      input({
        prefs: only({ pumpingReminders: true, pumpingIntervalMin: 180, pumpingEnabledAt: at(2026, 9, 1, 0) }),
        lastPumpAt: at(2026, 9, 1, 6),
        timers: [timer({ id: 'p1', activity: 'feeding', saveAs: 'pumping', start: at(2026, 9, 1, 6, 50) })],
      }),
      at(2026, 9, 1, 7),
    );
    expect(out).toEqual([]);
  });

  it('does not suppress for a running non-pumping timer', () => {
    const out = desiredScheduled(
      input({
        prefs: only({ pumpingReminders: true, pumpingIntervalMin: 180, pumpingEnabledAt: at(2026, 9, 1, 0) }),
        lastPumpAt: at(2026, 9, 1, 6),
        timers: [timer({ id: 's1', activity: 'sleep', saveAs: 'sleep', start: at(2026, 9, 1, 6, 50) })],
      }),
      at(2026, 9, 1, 7),
    );
    expect(out).toHaveLength(PUMP_AHEAD);
  });

  it('suppresses on a pumping timer owned by any child, matching lastPumpAt\'s own scope', () => {
    // `lastPumpAt` is derived from every pumping entry with no child filter (see
    // scheduleSync's toInput), so the suppression is scoped the same way. Unlike
    // naps, there is no per-child pump reminder for a sibling's timer to silence.
    const out = desiredScheduled(
      input({
        prefs: only({ pumpingReminders: true, pumpingIntervalMin: 180, pumpingEnabledAt: at(2026, 9, 1, 0) }),
        lastPumpAt: at(2026, 9, 1, 6),
        selectedChildId: 'c1',
        timers: [timer({ id: 'p1', childId: 'c2', activity: 'pumping', saveAs: 'pumping', start: at(2026, 9, 1, 6, 50) })],
      }),
      at(2026, 9, 1, 7),
    );
    expect(out).toEqual([]);
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

describe('nap suggestions', () => {
  // Born 2026-09-01. At `now` below she is 60 days old, so band 60 to 90,
  // firing at 90 - 15 = 75 minutes awake.
  const born = at(2026, 9, 1);
  const rowan = () => child({ id: 'c1', first: 'Rowan', birth: born });
  const now = at(2026, 10, 31, 10); // 10:00 local, age 60 days
  const napPrefs = { napSuggestions: true };

  const napInput = (over: Partial<ScheduleInput> = {}) =>
    input({
      children: [rowan()],
      prefs: prefs(napPrefs),
      lastSleepEndByChild: { c1: at(2026, 10, 31, 9) }, // woke 09:00
      ...over,
    });

  const naps = (i: ScheduleInput, t = now) =>
    desiredScheduled(i, t).filter((n) => n.kind === 'nap');

  it('fires 15 minutes before the upper bound of the age band', () => {
    const [n] = naps(napInput());
    expect(n.fireAt).toBe(at(2026, 10, 31, 10) + 15 * 60_000); // 09:00 + 1h15
    expect(n.title).toBe('Rowan may be ready for a nap');
    expect(n.body).toBe('Awake 1h 15m.');
    expect(n.data.url).toBe('/timers?child=c1');
    expect(n.identifier).toBe(`${REMINDER_PREFIX}nap:c1:${n.fireAt}`);
  });

  it('uses each age band', () => {
    const cases: [number, number][] = [
      [10, 45],   // to 30 days:  band hi 60
      [60, 75],   // to 90 days:  band hi 90
      [120, 105], // to 180 days: band hi 120
      [300, 165], // to 365 days: band hi 180
    ];
    for (const [ageDays, awakeMin] of cases) {
      const t = born + ageDays * 86_400_000;
      const woke = new Date(t);
      woke.setHours(9, 0, 0, 0);
      const at9 = woke.getTime();
      const [n] = naps(
        napInput({ lastSleepEndByChild: { c1: at9 } }),
        at9 + 60_000, // one minute after waking
      );
      expect(n.fireAt - at9).toBe(awakeMin * 60_000);
    }
  });

  it('is off unless the preference is on', () => {
    expect(naps(napInput({ prefs: prefs({ napSuggestions: false }) }))).toEqual([]);
  });

  it('says nothing while the child is asleep', () => {
    const t = timer({ id: 't1', childId: 'c1', saveAs: 'sleep' });
    expect(naps(napInput({ timers: [t] }))).toEqual([]);
  });

  it('does not suppress the nudge for a running non-sleep timer', () => {
    // Only a running SLEEP timer means the baby is currently asleep. A
    // running feeding (or any other) timer must not suppress the nudge.
    const t = timer({ id: 't1', childId: 'c1', activity: 'feeding', saveAs: 'feeding' });
    expect(naps(napInput({ timers: [t] })).length).toBe(1);
  });

  it('lets an ownerless sleep timer suppress nobody\'s nudge, selected child included', () => {
    // A timer persisted before childId stamping existed says nothing about who
    // is asleep, so it cannot answer for the selected child either. `hydrate`
    // stamps those on load; the nudge rule refuses to guess in the meantime.
    const t = timer({ id: 't1', childId: undefined, saveAs: 'sleep' });
    expect(naps(napInput({ timers: [t], selectedChildId: 'c1' })).length).toBe(1);
    expect(naps(napInput({ timers: [t], selectedChildId: 'c2' })).length).toBe(1);
  });

  it('says nothing while the child has an ongoing sleep ENTRY with no running timer', () => {
    // e.g. a sleep entry edited to "still ongoing" (end: null, no Timer
    // created), or a server sleep record with no end.
    expect(naps(napInput({ asleepChildIds: { c1: true } }))).toEqual([]);
  });

  it('a DIFFERENT child\'s ongoing sleep entry does not suppress this child\'s nudge', () => {
    expect(naps(napInput({ asleepChildIds: { c2: true } })).length).toBe(1);
  });

  it('says nothing without an anchor', () => {
    expect(naps(napInput({ lastSleepEndByChild: {} }))).toEqual([]);
  });

  it('says nothing for an expecting child', () => {
    expect(naps(napInput({ children: [child({ id: 'c1', expected: true, birth: born })] }))).toEqual([]);
  });

  it('stops past the age the wake-window source covers', () => {
    const t = born + 366 * 86_400_000;
    const woke = new Date(t);
    woke.setHours(9, 0, 0, 0);
    expect(
      naps(napInput({ lastSleepEndByChild: { c1: woke.getTime() } }), woke.getTime() + 60_000),
    ).toEqual([]);
  });

  it('does not schedule a fire time already past', () => {
    // Woke at 09:00, fire is 10:15, and it is already 11:00.
    expect(naps(napInput(), at(2026, 10, 31, 11))).toEqual([]);
  });

  describe('quiet hours', () => {
    it('drops a fire time at or after 19:00', () => {
      // Woke 17:45 + 1h15 = exactly 19:00. Excluded.
      const woke = at(2026, 10, 31, 17) + 45 * 60_000;
      expect(naps(napInput({ lastSleepEndByChild: { c1: woke } }), woke + 60_000)).toEqual([]);
    });

    it('keeps a fire time at exactly 07:00', () => {
      // Woke 05:45 + 1h15 = exactly 07:00. Included.
      const woke = at(2026, 10, 31, 5) + 45 * 60_000;
      const [n] = naps(napInput({ lastSleepEndByChild: { c1: woke } }), woke + 60_000);
      expect(n.fireAt).toBe(at(2026, 10, 31, 7));
    });

    it('drops rather than defers an overnight window', () => {
      // Woke 03:00, would fire 04:15. Nothing is scheduled, and in particular
      // nothing is pushed to 07:00: by then the anchor is stale.
      const woke = at(2026, 10, 31, 3);
      expect(naps(napInput({ lastSleepEndByChild: { c1: woke } }), woke + 60_000)).toEqual([]);
    });
  });

  it('re-anchors to a newer sleep, so the diff reschedules', () => {
    const first = naps(napInput())[0];
    const later = naps(napInput({ lastSleepEndByChild: { c1: at(2026, 10, 31, 9) + 30 * 60_000 } }))[0];
    expect(later.identifier).not.toBe(first.identifier);
    const { toSchedule, toCancel } = diffScheduled(
      [{ identifier: first.identifier, title: first.title, body: first.body }],
      [later],
    );
    expect(toCancel).toEqual([first.identifier]);
    expect(toSchedule).toEqual([later]);
  });

  it('handles two awake children independently', () => {
    const out = naps(
      napInput({
        children: [rowan(), child({ id: 'c2', first: 'Sam', birth: born })],
        lastSleepEndByChild: { c1: at(2026, 10, 31, 9), c2: at(2026, 10, 31, 9) + 20 * 60_000 },
      }),
    );
    expect(out.map((n) => n.title)).toEqual([
      'Rowan may be ready for a nap',
      'Sam may be ready for a nap',
    ]);
  });

  it('one child napping does not suppress the other', () => {
    const out = naps(
      napInput({
        children: [rowan(), child({ id: 'c2', first: 'Sam', birth: born })],
        timers: [timer({ id: 't1', childId: 'c1', saveAs: 'sleep' })],
        lastSleepEndByChild: { c1: at(2026, 10, 31, 9), c2: at(2026, 10, 31, 9) },
      }),
    );
    expect(out.map((n) => n.title)).toEqual(['Sam may be ready for a nap']);
  });
});

describe('desiredScheduled: treatments, fixed times of day', () => {
  const only = (over: Partial<ReminderPrefs>) =>
    prefs({
      dueDateReminders: false,
      staleTimerReminders: false,
      ageMilestones: false,
      treatmentReminders: true,
      ...over,
    });

  const treatment = (over: Partial<Treatment> = {}): Treatment => ({
    id: 'treatment1',
    childId: 'c1',
    name: 'Omeprazol',
    scheduleMode: 'timesOfDay',
    timesOfDay: ['morning', 'evening'],
    fromDate: at(2026, 9, 1),
    active: true,
    ...over,
  });

  const run = (over: Partial<ScheduleInput>, now: number) =>
    desiredScheduled(input({ prefs: only({}), selectedChildId: 'c1', ...over }), now);

  it('schedules each chosen slot at its mapped wall-clock hour', () => {
    const out = run({ treatments: [treatment()] }, at(2026, 9, 2, 6));
    expect(out[0].fireAt).toBe(at(2026, 9, 2, 8));
    expect(out[1].fireAt).toBe(at(2026, 9, 2, 18));
    expect(out[2].fireAt).toBe(at(2026, 9, 3, 8));
  });

  it('names the treatment and carries its dosage and treatment-seeded tap target', () => {
    const out = run({ treatments: [treatment({ dosage: 5, dosageUnit: 'mg' })] }, at(2026, 9, 2, 6));
    expect(out[0].kind).toBe('treatment');
    expect(out[0].title).toBe('Omeprazol due');
    expect(out[0].body).toBe('5 mg');
    expect(out[0].data.url).toBe('/log/medication?treatment=treatment1&child=c1');
    expect(out[0].identifier).toBe(`${REMINDER_PREFIX}treatment:treatment1:${at(2026, 9, 2, 8)}`);
  });

  it('falls back to an instruction when the treatment records no dosage', () => {
    const out = run({ treatments: [treatment()] }, at(2026, 9, 2, 6));
    expect(out[0].body).toBe('Tap to log the dose.');
  });

  it('emits slots in chronological order regardless of the order they were picked', () => {
    const out = run({ treatments: [treatment({ timesOfDay: ['night', 'morning', 'noon'] })] }, at(2026, 9, 2, 6));
    expect(out[0].fireAt).toBe(at(2026, 9, 2, 8));
    expect(out[1].fireAt).toBe(at(2026, 9, 2, 12));
    expect(out[2].fireAt).toBe(at(2026, 9, 2, 22));
  });

  it('keeps every occurrence on its mapped hour across an autumn-back boundary', () => {
    // Built and asserted with calendar arithmetic on each day's own midnight,
    // never by adding 86_400_000: a fixed millisecond day drifts by an hour
    // across a DST change and would move the 08:00 dose to 07:00 or 09:00 for
    // half the year. In a timezone without DST this is a tautology; in one with
    // it, it is the whole point. The eight-day run from 24 October crosses the
    // European clock change on the 25th.
    const out = run({ treatments: [treatment({ timesOfDay: ['morning'], fromDate: at(2026, 10, 20) })] }, at(2026, 10, 24, 6));
    expect(out).toHaveLength(TREATMENT_AHEAD);
    expect(out.every((n) => new Date(n.fireAt).getHours() === 8)).toBe(true);
    expect(out[0].fireAt).toBe(at(2026, 10, 24, 8));
    expect(out[4].fireAt).toBe(at(2026, 10, 28, 8));
  });

  it('keeps every occurrence on its mapped hour across a spring-forward boundary', () => {
    // The other direction, which fails differently: a millisecond day walk
    // lands at 09:00 here rather than 07:00. The eight-day run from 27 March
    // crosses the European clock change on the 29th.
    const out = run({ treatments: [treatment({ timesOfDay: ['morning'], fromDate: at(2026, 3, 20) })] }, at(2026, 3, 27, 6));
    expect(out).toHaveLength(TREATMENT_AHEAD);
    expect(out.every((n) => new Date(n.fireAt).getHours() === 8)).toBe(true);
    expect(out[0].fireAt).toBe(at(2026, 3, 27, 8));
    expect(out[4].fireAt).toBe(at(2026, 3, 31, 8));
  });

  it("suppresses today's kth slot once k doses are logged today", () => {
    // One dose given on a morning+evening treatment. Counting, not slot matching:
    // the dose settles the FIRST slot and leaves the second owed, so exactly
    // one of today's two slots survives.
    const out = run(
      { treatments: [treatment()], treatmentDoses: { treatment1: { today: 1, lastAt: at(2026, 9, 2, 7) } } },
      at(2026, 9, 2, 6),
    );
    const today = out.filter((n) => n.fireAt < at(2026, 9, 3));
    expect(today).toHaveLength(1);
    expect(today[0].fireAt).toBe(at(2026, 9, 2, 18));
  });

  it('counts k from the start of the day, not from now', () => {
    // Morning and noon have already passed and two doses were logged, so the
    // evening slot is k = 3 and survives. Numbering the remaining slots from
    // now would make evening k = 1, see dosesToday >= 1, and wrongly drop it.
    const out = run(
      {
        treatments: [treatment({ timesOfDay: ['morning', 'noon', 'evening'] })],
        treatmentDoses: { treatment1: { today: 2, lastAt: at(2026, 9, 2, 12) } },
      },
      at(2026, 9, 2, 14),
    );
    expect(out[0].fireAt).toBe(at(2026, 9, 2, 18));
  });

  it('suppresses nothing on future days, whatever today looked like', () => {
    const out = run(
      { treatments: [treatment()], treatmentDoses: { treatment1: { today: 2, lastAt: at(2026, 9, 2, 18) } } },
      at(2026, 9, 2, 20),
    );
    expect(out[0].fireAt).toBe(at(2026, 9, 3, 8));
    expect(out[1].fireAt).toBe(at(2026, 9, 3, 18));
  });

  it('caps output at TREATMENT_AHEAD occurrences', () => {
    const out = run({ treatments: [treatment()] }, at(2026, 9, 2, 6));
    expect(out).toHaveLength(TREATMENT_AHEAD);
  });

  it('emits one notification per treatment when two are due at the same slot', () => {
    const out = run(
      {
        treatments: [
          treatment({ timesOfDay: ['morning'] }),
          treatment({ id: 'treatment2', name: 'Amoxicilline', timesOfDay: ['morning'] }),
        ],
      },
      at(2026, 9, 2, 6),
    );
    const first = out.filter((n) => n.fireAt === at(2026, 9, 2, 8));
    expect(first.map((n) => n.title).sort()).toEqual(['Amoxicilline due', 'Omeprazol due']);
  });

  it('stops at toDate rather than scheduling past the end of the regimen', () => {
    const out = run({ treatments: [treatment({ toDate: at(2026, 9, 3) })] }, at(2026, 9, 2, 6));
    // toDate is inclusive, so 3 September's slots are the last ones.
    expect(out.every((n) => n.fireAt < at(2026, 9, 4))).toBe(true);
    expect(out.map((n) => n.fireAt)).toContain(at(2026, 9, 3, 18));
  });

  it('terminates on a treatment with no times of day chosen', () => {
    expect(run({ treatments: [treatment({ timesOfDay: [] })] }, at(2026, 9, 2, 6))).toEqual([]);
    expect(run({ treatments: [treatment({ timesOfDay: undefined })] }, at(2026, 9, 2, 6))).toEqual([]);
  });

  it('schedules nothing for a paused treatment', () => {
    expect(run({ treatments: [treatment({ active: false })] }, at(2026, 9, 2, 6))).toEqual([]);
  });

  it('schedules nothing before fromDate or after toDate', () => {
    expect(run({ treatments: [treatment({ fromDate: at(2026, 9, 10) })] }, at(2026, 9, 2, 6))).toEqual([]);
    expect(run({ treatments: [treatment({ toDate: at(2026, 9, 1) })] }, at(2026, 9, 2, 6))).toEqual([]);
  });

  it('schedules nothing for a treatment belonging to another child', () => {
    expect(run({ treatments: [treatment({ childId: 'c2' })] }, at(2026, 9, 2, 6))).toEqual([]);
  });

  it('schedules nothing while the selected child is expected, since a treatment cannot be dosed against a due date', () => {
    // Every other reminder kind guards `child.expected`; this one must too,
    // because resolveLogDeepLink (src/lib/logDeepLink.ts) refuses to open
    // anything for an expected child, so a scheduled "X due" alert would be a
    // tap the app itself cannot service.
    expect(
      run({ treatments: [treatment()], children: [child({ id: 'c1', expected: true })] }, at(2026, 9, 2, 6)),
    ).toEqual([]);
  });

  it('schedules nothing for a treatment whose name is blank', () => {
    // `logMedicationFromTreatment` refuses a blank name, so such a notification would
    // dead-tap. It would also read as " due".
    expect(run({ treatments: [treatment({ name: '   ' })] }, at(2026, 9, 2, 6))).toEqual([]);
  });

  it('schedules nothing while the pref is off', () => {
    const out = desiredScheduled(
      input({ prefs: only({ treatmentReminders: false }), treatments: [treatment()], selectedChildId: 'c1' }),
      at(2026, 9, 2, 6),
    );
    expect(out).toEqual([]);
  });
});

describe('desiredScheduled: treatments, every N hours', () => {
  const only = (over: Partial<ReminderPrefs> = {}) =>
    prefs({
      dueDateReminders: false,
      staleTimerReminders: false,
      ageMilestones: false,
      treatmentReminders: true,
      ...over,
    });

  const treatment = (over: Partial<Treatment> = {}): Treatment => ({
    id: 'treatment1',
    childId: 'c1',
    name: 'Amoxicilline',
    scheduleMode: 'everyHours',
    everyHours: 8,
    fromDate: at(2026, 9, 1),
    active: true,
    ...over,
  });

  const run = (over: Partial<ScheduleInput>, now: number, p: Partial<ReminderPrefs> = {}) =>
    desiredScheduled(input({ prefs: only(p), selectedChildId: 'c1', ...over }), now);

  it('anchors the grid on the last logged dose', () => {
    const out = run(
      { treatments: [treatment()], treatmentDoses: { treatment1: { today: 1, lastAt: at(2026, 9, 2, 6) } } },
      at(2026, 9, 2, 7),
    );
    expect(out).toHaveLength(TREATMENT_AHEAD);
    expect(out[0].fireAt).toBe(at(2026, 9, 2, 14));
    expect(out[1].fireAt).toBe(at(2026, 9, 2, 22));
    expect(out[0].title).toBe('Amoxicilline due');
  });

  it('re-anchors when a newer dose is logged', () => {
    const a = run(
      { treatments: [treatment()], treatmentDoses: { treatment1: { today: 1, lastAt: at(2026, 9, 2, 6) } } },
      at(2026, 9, 2, 7),
    );
    const b = run(
      { treatments: [treatment()], treatmentDoses: { treatment1: { today: 2, lastAt: at(2026, 9, 2, 7) } } },
      at(2026, 9, 2, 7),
    );
    expect(b[0].fireAt).toBe(at(2026, 9, 2, 15));
    expect(a[0].identifier).not.toBe(b[0].identifier);
  });

  it('re-enters the grid on phase when every occurrence has already passed', () => {
    // Dosed two days ago, app never opened since. Scheduling blindly from the
    // anchor would produce only past instants and therefore nothing at all.
    const out = run(
      { treatments: [treatment()], treatmentDoses: { treatment1: { today: 0, lastAt: at(2026, 9, 1, 6) } } },
      at(2026, 9, 3, 7),
    );
    expect(out).toHaveLength(TREATMENT_AHEAD);
    expect(out.every((n) => n.fireAt > at(2026, 9, 3, 7))).toBe(true);
    expect(out[0].fireAt).toBe(at(2026, 9, 3, 14));
  });

  it('schedules nothing for an interval treatment that has never been dosed', () => {
    // "Every 8 hours" means eight hours after the last dose. With no last dose
    // there is no defined next instant, and any anchor invented for one is a
    // guess. The in-app tile still shows it as due, so nobody is left unaware.
    expect(run({ treatments: [treatment()], treatmentDoses: { treatment1: { today: 0, lastAt: null } } }, at(2026, 9, 2, 7))).toEqual([]);
    expect(run({ treatments: [treatment()], treatmentDoses: {} }, at(2026, 9, 2, 7))).toEqual([]);
  });

  it('schedules nothing for an interval treatment with no interval set', () => {
    expect(
      run(
        { treatments: [treatment({ everyHours: undefined })], treatmentDoses: { treatment1: { today: 1, lastAt: at(2026, 9, 2, 6) } } },
        at(2026, 9, 2, 7),
      ),
    ).toEqual([]);
  });

  it('moves an existing grid forward when the resync stamp is later than the last dose', () => {
    const out = run(
      { treatments: [treatment()], treatmentDoses: { treatment1: { today: 1, lastAt: at(2026, 9, 2, 6) } } },
      at(2026, 9, 2, 11),
      { treatmentRemindersEnabledAt: at(2026, 9, 2, 10) },
    );
    expect(out[0].fireAt).toBe(at(2026, 9, 2, 18));
  });

  it('ignores a resync stamp older than the last dose', () => {
    const out = run(
      { treatments: [treatment()], treatmentDoses: { treatment1: { today: 1, lastAt: at(2026, 9, 2, 6) } } },
      at(2026, 9, 2, 7),
      { treatmentRemindersEnabledAt: at(2026, 9, 1, 10) },
    );
    expect(out[0].fireAt).toBe(at(2026, 9, 2, 14));
  });

  it('still schedules nothing when the resync stamp is set but no dose was ever logged', () => {
    // The ordering guard. A plain Math.max(lastAt ?? 0, enabledAt ?? 0), which
    // is what pumpReminders does, would manufacture a grid here out of a time
    // the app invented. The stamp may only ever MOVE an existing grid.
    expect(
      run({ treatments: [treatment()], treatmentDoses: { treatment1: { today: 0, lastAt: null } } }, at(2026, 9, 2, 11), {
        treatmentRemindersEnabledAt: at(2026, 9, 2, 10),
      }),
    ).toEqual([]);
  });

  it('does not let the resync stamp shift a times-of-day treatment', () => {
    // Those instants come off the wall clock, not off a phase, so there is
    // nothing for a rebase to move. Toggling off and on cannot move an 08:00
    // dose, and should not.
    const todTreatment: Treatment = {
      id: 'treatment2',
      childId: 'c1',
      name: 'Omeprazol',
      scheduleMode: 'timesOfDay',
      timesOfDay: ['morning'],
      fromDate: at(2026, 9, 1),
      active: true,
    };
    const out = run({ treatments: [todTreatment] }, at(2026, 9, 2, 6), {
      treatmentRemindersEnabledAt: at(2026, 9, 2, 5),
    });
    expect(out[0].fireAt).toBe(at(2026, 9, 2, 8));
  });

  it('keeps the identifier stable as now advances within the same occurrence', () => {
    const doses = { treatment1: { today: 1, lastAt: at(2026, 9, 2, 6) } };
    const a = run({ treatments: [treatment()], treatmentDoses: doses }, at(2026, 9, 2, 7));
    const b = run({ treatments: [treatment()], treatmentDoses: doses }, at(2026, 9, 2, 8));
    expect(a[0].identifier).toBe(b[0].identifier);
  });

  it('changes the identifier when the interval changes', () => {
    const doses = { treatment1: { today: 1, lastAt: at(2026, 9, 2, 6) } };
    const a = run({ treatments: [treatment({ everyHours: 8 })], treatmentDoses: doses }, at(2026, 9, 2, 7));
    const b = run({ treatments: [treatment({ everyHours: 6 })], treatmentDoses: doses }, at(2026, 9, 2, 7));
    expect(a[0].identifier).not.toBe(b[0].identifier);
  });

  it('stops at the end of the day toDate names', () => {
    const out = run(
      { treatments: [treatment({ toDate: at(2026, 9, 2) })], treatmentDoses: { treatment1: { today: 1, lastAt: at(2026, 9, 2, 6) } } },
      at(2026, 9, 2, 7),
    );
    // 14:00 and 22:00 fall inside the last day; 06:00 the next morning does not.
    expect(out.map((n) => n.fireAt)).toEqual([at(2026, 9, 2, 14), at(2026, 9, 2, 22)]);
  });

  it('schedules nothing for a paused interval treatment', () => {
    expect(
      run(
        { treatments: [treatment({ active: false })], treatmentDoses: { treatment1: { today: 1, lastAt: at(2026, 9, 2, 6) } } },
        at(2026, 9, 2, 7),
      ),
    ).toEqual([]);
  });
});

describe('desiredScheduled: milestone catch-up', () => {
  const born = child({ birth: at(2026, 9, 1) });
  const on = (over: Partial<ReminderPrefs> = {}) =>
    prefs({
      dueDateReminders: false,
      staleTimerReminders: false,
      ageMilestones: false,
      milestoneCatchUp: true,
      ...over,
    });
  const run = (over: Partial<ScheduleInput> = {}, now = at(2026, 9, 1, 12)) =>
    desiredScheduled(input({ children: [born], prefs: on(), ...over }), now);

  it('schedules nothing while the toggle is off', () => {
    expect(
      desiredScheduled(input({ children: [born], prefs: on({ milestoneCatchUp: false }) }), at(2026, 9, 1, 12)),
    ).toEqual([]);
  });

  it('never fires before the home-screen nudge would show the same milestone', () => {
    // The load-bearing guarantee: `MilestoneNudge` renders `overdueUnlogged`,
    // so every scheduled alert must name milestones that call already returns
    // at its own fire time. A calendar-month fire date fails this.
    for (const n of run()) {
      const keys = n.identifier.split(':')[3].split(',');
      const overdue = overdueUnlogged(ageMonths(born.birth, n.fireAt), new Map(), []).map((m) => m.key);
      for (const k of keys) expect(overdue).toContain(k);
    }
  });

  it('groups every milestone closing on the same morning into one notification', () => {
    const out = run();
    // `lifts-head` and `first-smile` both close at 3 months.
    const shared = out.find((n) => n.identifier.includes('lifts-head'));
    expect(shared?.identifier).toContain('first-smile');
    expect(shared?.title).toBe('2 milestones to check for Rowan.');
    expect(shared?.body).toBe('Lifts head, First smile.');
    expect(out.map((n) => n.fireAt)).toEqual([...new Set(out.map((n) => n.fireAt))]);
  });

  it('names the typical window when only one milestone closes', () => {
    const out = run({ reachedMilestoneKeysByChild: { c1: ['first-smile'] } });
    const solo = out.find((n) => n.identifier.includes('lifts-head'));
    expect(solo?.title).toBe('A milestone to check for Rowan.');
    expect(solo?.body).toBe('Lifts head. Most babies do this by 3 months.');
    expect(solo?.data.url).toBe('/milestones?child=c1');
  });

  it('skips milestones already logged or already answered', () => {
    const out = run({
      reachedMilestoneKeysByChild: { c1: ['lifts-head'] },
      answeredMilestoneKeysByChild: { c1: ['first-smile'] },
    });
    expect(out.some((n) => n.identifier.includes('lifts-head'))).toBe(false);
    expect(out.some((n) => n.identifier.includes('first-smile'))).toBe(false);
  });

  it('changes the identifier when one of a batch is logged, so the diff replaces it', () => {
    const before = run().find((n) => n.identifier.includes('lifts-head'));
    const after = run({ reachedMilestoneKeysByChild: { c1: ['first-smile'] } }).find((n) =>
      n.identifier.includes('lifts-head'),
    );
    expect(before?.identifier).not.toBe(after?.identifier);
    expect(before?.fireAt).toBe(after?.fireAt);
  });

  it('fires at 09:00 and stays inside the age horizon', () => {
    const out = run();
    expect(out.length).toBeGreaterThan(0);
    const horizon = addMonths(at(2026, 9, 1, 12), AGE_HORIZON_MONTHS);
    for (const n of out) {
      expect(new Date(n.fireAt).getHours()).toBe(9);
      expect(n.fireAt).toBeGreaterThan(at(2026, 9, 1, 12));
      expect(n.fireAt).toBeLessThanOrEqual(horizon);
    }
  });

  it('schedules nothing for an expected child', () => {
    expect(run({ children: [child({ expected: true })] })).toEqual([]);
  });

  it('nudges every child, each against their own history', () => {
    // Was "only ever covers the selected child". The keys can answer per child
    // now, so a sibling is no longer read as having reached nothing.
    const sibling = child({ id: 'c2', first: 'Wren', birth: at(2026, 9, 1) });
    const out = run({
      children: [born, sibling],
      reachedMilestoneKeysByChild: { c1: ['lifts-head'] },
    });

    expect(out.some((n) => n.identifier.includes(':c1:'))).toBe(true);
    expect(out.some((n) => n.identifier.includes(':c2:'))).toBe(true);
    // c1 logged it, c2 did not, so only c2 is nudged about it.
    const liftsHead = out.filter((n) => n.identifier.includes('lifts-head'));
    expect(liftsHead).toHaveLength(1);
    expect(liftsHead[0].identifier).toContain(':c2:');
  });

  it('gives two children closing the same window two alerts, each deep-linking to its own child', () => {
    const sibling = child({ id: 'c2', first: 'Wren', birth: at(2026, 9, 1) });
    const out = run({ children: [born, sibling] });

    const sameMorning = out.filter((n) => n.fireAt === out[0].fireAt);
    expect(sameMorning).toHaveLength(2);
    expect(sameMorning.map((n) => n.data.url).sort()).toEqual([
      '/milestones?child=c1',
      '/milestones?child=c2',
    ]);
    // `lifts-head` and `first-smile` both close at 3 months (see the "groups
    // every milestone" test above), so the earliest window for a newborn
    // always groups both into one notification per child, not one milestone.
    expect(sameMorning.map((n) => n.title).sort()).toEqual(
      [`2 milestones to check for Rowan.`, `2 milestones to check for Wren.`].sort(),
    );
  });

  it("reads a child with no entry in either map as having reached nothing", () => {
    // The maps are sparse: a child who has logged no milestone and answered no
    // prompt has no key at all, which must not throw and must not suppress.
    const out = run({ reachedMilestoneKeysByChild: {}, answeredMilestoneKeysByChild: {} });
    expect(out.length).toBeGreaterThan(0);
  });
});

/**
 * The delivered half of the reconcile. `diffScheduled` above only ever sees
 * PENDING alerts, and a notification leaves the pending set the moment it
 * fires, so nothing there can reach a banner already sitting in the tray.
 */
describe('staleDelivered', () => {
  const rowan = child({ id: 'c1', first: 'Rowan', birth: at(2026, 9, 1) });
  const wren = child({ id: 'c2', first: 'Wren', birth: at(2026, 9, 1) });
  const now = at(2026, 10, 31, 10, 30);

  const napId = (childId: string, fireAt: number) => `${REMINDER_PREFIX}nap:${childId}:${fireAt}`;
  const staleId = (timerId: string, fireAt: number) => `${REMINDER_PREFIX}stale:${timerId}:${fireAt}`;
  const pumpId = (anchor: number, n: number, fireAt: number) =>
    `${REMINDER_PREFIX}pump:${anchor}:${n}:${fireAt}`;
  const treatmentId = (id: string, fireAt: number) => `${REMINDER_PREFIX}treatment:${id}:${fireAt}`;

  describe('ownership', () => {
    it('never dismisses an identifier without the budkin prefix', () => {
      // A timer notification's bare uuid. Different subsystem, not ours.
      expect(
        staleDelivered(input({ children: [rowan] }), ['3fa85f64-5717-4562-b3fc-2c963f66afa6'], now),
      ).toEqual([]);
    });

    it('leaves due, age and milestone reminders delivered', () => {
      // These three report a calendar fact that stays true once it fires. No
      // condition can retire them, so they are out of scope.
      const ids = [
        `${REMINDER_PREFIX}due:c1:day:${now}`,
        `${REMINDER_PREFIX}age:c1:3m:${now}`,
        `${REMINDER_PREFIX}milestone:c1:lifts-head,first-smile:${now}`,
      ];
      expect(staleDelivered(input({ children: [rowan] }), ids, now)).toEqual([]);
    });

    it('ignores a malformed identifier rather than throwing', () => {
      const ids = [REMINDER_PREFIX, `${REMINDER_PREFIX}nap`, `${REMINDER_PREFIX}nap:c1:not-a-number`];
      expect(staleDelivered(input({ children: [rowan] }), ids, now)).toEqual([]);
    });
  });

  describe('nap suggestions', () => {
    const fireAt = at(2026, 10, 31, 10, 15);

    it('dismisses the nudge once a sleep timer starts for that child', () => {
      const i = input({
        children: [rowan],
        timers: [timer({ id: 't1', childId: 'c1', saveAs: 'sleep', start: at(2026, 10, 31, 10, 20) })],
      });
      expect(staleDelivered(i, [napId('c1', fireAt)], now)).toEqual([napId('c1', fireAt)]);
    });

    it('dismisses the nudge for an ongoing sleep ENTRY that carries no timer', () => {
      const i = input({ children: [rowan], asleepChildIds: { c1: true } });
      expect(staleDelivered(i, [napId('c1', fireAt)], now)).toEqual([napId('c1', fireAt)]);
    });

    it('KEEPS a nudge that just fired and is still true, the child being awake', () => {
      // The whole feature turns on this one. A desired reminder leaves the
      // desired set the instant it fires (`fireAt <= now` drops it), so a
      // "dismiss anything not desired" rule would wipe every banner on arrival.
      expect(staleDelivered(input({ children: [rowan] }), [napId('c1', fireAt)], now)).toEqual([]);
    });

    it("a sibling's nap does not dismiss this child's nudge", () => {
      const i = input({
        children: [rowan, wren],
        selectedChildId: 'c1',
        timers: [timer({ id: 't1', childId: 'c2', saveAs: 'sleep', start: at(2026, 10, 31, 10, 20) })],
        asleepChildIds: { c2: true },
      });
      expect(staleDelivered(i, [napId('c1', fireAt)], now)).toEqual([]);
    });

    it("keys on the identifier's own child, not the selected one", () => {
      // c2 is asleep and c2's banner must go, even though c1 is selected.
      const i = input({ children: [rowan, wren], selectedChildId: 'c1', asleepChildIds: { c2: true } });
      expect(staleDelivered(i, [napId('c1', fireAt), napId('c2', fireAt)], now)).toEqual([
        napId('c2', fireAt),
      ]);
    });

    it('dismisses nothing for an ownerless sleep timer, as napReminders suppresses nothing', () => {
      const i = input({
        children: [rowan, wren],
        selectedChildId: 'c1',
        timers: [timer({ id: 't1', childId: undefined, saveAs: 'sleep', start: at(2026, 10, 31, 10, 20) })],
      });
      expect(staleDelivered(i, [napId('c1', fireAt), napId('c2', fireAt)], now)).toEqual([]);
    });

    it('does not dismiss for a running non-sleep timer', () => {
      const i = input({
        children: [rowan],
        timers: [timer({ id: 't1', childId: 'c1', saveAs: 'feeding', start: at(2026, 10, 31, 10, 20) })],
      });
      expect(staleDelivered(i, [napId('c1', fireAt)], now)).toEqual([]);
    });
  });

  describe('stale timer alerts', () => {
    const fireAt = at(2026, 10, 31, 10, 15);

    it('dismisses the alert once its timer is gone', () => {
      const i = input({ children: [rowan], timers: [] });
      expect(staleDelivered(i, [staleId('t1', fireAt)], now)).toEqual([staleId('t1', fireAt)]);
    });

    it('KEEPS the alert while its timer is still running, which is the whole point of it', () => {
      const i = input({ children: [rowan], timers: [timer({ id: 't1' })] });
      expect(staleDelivered(i, [staleId('t1', fireAt)], now)).toEqual([]);
    });

    it('matches on the timer id alone, not on which child owns it', () => {
      const i = input({ children: [rowan, wren], timers: [timer({ id: 't1', childId: 'c2' })] });
      expect(staleDelivered(i, [staleId('t1', fireAt)], now)).toEqual([]);
    });
  });

  describe('pumping', () => {
    const anchor = at(2026, 10, 31, 7);
    const fireAt = at(2026, 10, 31, 10);

    it('dismisses while a pumping timer is running', () => {
      const i = input({
        timers: [timer({ id: 'p1', saveAs: 'pumping', start: at(2026, 10, 31, 10, 5) })],
        lastPumpAt: anchor,
      });
      expect(staleDelivered(i, [pumpId(anchor, 1, fireAt)], now)).toEqual([pumpId(anchor, 1, fireAt)]);
    });

    it('dismisses once a pumping entry is logged at or after the fire time', () => {
      expect(staleDelivered(input({ lastPumpAt: fireAt }), [pumpId(anchor, 1, fireAt)], now)).toEqual([
        pumpId(anchor, 1, fireAt),
      ]);
    });

    it('KEEPS the reminder when the last pump predates it and nothing is running', () => {
      expect(staleDelivered(input({ lastPumpAt: anchor }), [pumpId(anchor, 1, fireAt)], now)).toEqual([]);
    });

    it('KEEPS the reminder when nothing has ever been pumped', () => {
      expect(staleDelivered(input({ lastPumpAt: null }), [pumpId(anchor, 1, fireAt)], now)).toEqual([]);
    });
  });

  describe('treatments, fixed times of day', () => {
    const morning = at(2026, 10, 31, 8);
    const evening = at(2026, 10, 31, 18);
    const t = (over: Partial<Treatment> = {}): Treatment => ({
      id: 'treatment1',
      childId: 'c1',
      name: 'Omeprazol',
      scheduleMode: 'timesOfDay',
      timesOfDay: ['morning', 'evening'],
      fromDate: at(2026, 9, 1),
      active: true,
      ...over,
    });

    it('dismisses the morning slot once a dose is logged today', () => {
      const i = input({
        treatments: [t()],
        treatmentDoses: { treatment1: { today: 1, lastAt: at(2026, 10, 31, 8, 5) } },
      });
      expect(staleDelivered(i, [treatmentId('treatment1', morning)], now)).toEqual([
        treatmentId('treatment1', morning),
      ]);
    });

    it('KEEPS the morning slot while no dose has been logged today', () => {
      const i = input({ treatments: [t()], treatmentDoses: { treatment1: { today: 0, lastAt: null } } });
      expect(staleDelivered(i, [treatmentId('treatment1', morning)], now)).toEqual([]);
    });

    it('settles the EARLIEST owed slot only, matching the counting rule', () => {
      // Both slots have fired and one late dose arrived. Counting says the first
      // slot is settled and the second is still owed. A per-slot "any later dose
      // clears it" rule would wrongly clear both.
      const i = input({
        treatments: [t()],
        treatmentDoses: { treatment1: { today: 1, lastAt: at(2026, 10, 31, 19, 5) } },
      });
      const ids = [treatmentId('treatment1', morning), treatmentId('treatment1', evening)];
      expect(staleDelivered(i, ids, at(2026, 10, 31, 19, 30))).toEqual([treatmentId('treatment1', morning)]);
    });

    it('dismisses both slots once both doses are logged', () => {
      const i = input({
        treatments: [t()],
        treatmentDoses: { treatment1: { today: 2, lastAt: at(2026, 10, 31, 19, 5) } },
      });
      const ids = [treatmentId('treatment1', morning), treatmentId('treatment1', evening)];
      expect(staleDelivered(i, ids, at(2026, 10, 31, 19, 30))).toEqual(ids);
    });

    it("KEEPS a slot from a previous day, which today's dose count says nothing about", () => {
      const i = input({
        treatments: [t()],
        treatmentDoses: { treatment1: { today: 2, lastAt: at(2026, 10, 31, 8, 5) } },
      });
      expect(staleDelivered(i, [treatmentId('treatment1', at(2026, 10, 30, 18))], now)).toEqual([]);
    });

    it('KEEPS a slot for a treatment with no dose scalars, whose history is unreliable', () => {
      // In server mode `entries` only holds the selected child, so another
      // child's dose history reads as empty. `treatmentDoseScalars` gives every
      // treatment it considered a key, so an absent key means "not considered",
      // never "no doses".
      const i = input({ treatments: [t({ id: 'treatment2', childId: 'c2' })], treatmentDoses: {} });
      expect(staleDelivered(i, [treatmentId('treatment2', morning)], now)).toEqual([]);
    });

    it('KEEPS a slot for a treatment the store no longer holds', () => {
      expect(
        staleDelivered(input({ treatments: [], treatmentDoses: {} }), [treatmentId('treatment1', morning)], now),
      ).toEqual([]);
    });

    it("KEEPS a fire time that matches none of the treatment's slots", () => {
      // The parent removed the evening slot, so a banner from it can no longer
      // be counted against the remaining schedule.
      const i = input({
        treatments: [t({ timesOfDay: ['morning'] })],
        treatmentDoses: { treatment1: { today: 1, lastAt: at(2026, 10, 31, 8, 5) } },
      });
      expect(staleDelivered(i, [treatmentId('treatment1', evening)], now)).toEqual([]);
    });
  });

  describe('treatments, every N hours', () => {
    const fireAt = at(2026, 10, 31, 10);
    const t = (over: Partial<Treatment> = {}): Treatment => ({
      id: 'treatment1',
      childId: 'c1',
      name: 'Amoxicilline',
      scheduleMode: 'everyHours',
      everyHours: 8,
      fromDate: at(2026, 9, 1),
      active: true,
      ...over,
    });

    it('dismisses once a dose re-anchors the grid past now', () => {
      const i = input({
        treatments: [t()],
        treatmentDoses: { treatment1: { today: 1, lastAt: at(2026, 10, 31, 10, 5) } },
      });
      expect(staleDelivered(i, [treatmentId('treatment1', fireAt)], now)).toEqual([
        treatmentId('treatment1', fireAt),
      ]);
    });

    it('KEEPS the reminder while the interval since the last dose has elapsed', () => {
      const i = input({
        treatments: [t()],
        treatmentDoses: { treatment1: { today: 1, lastAt: at(2026, 10, 31, 2) } },
      });
      expect(staleDelivered(i, [treatmentId('treatment1', fireAt)], now)).toEqual([]);
    });

    it('KEEPS the reminder for a treatment that has never been dosed', () => {
      const i = input({ treatments: [t()], treatmentDoses: { treatment1: { today: 0, lastAt: null } } });
      expect(staleDelivered(i, [treatmentId('treatment1', fireAt)], now)).toEqual([]);
    });

    it('KEEPS the reminder for an interval treatment with no interval set', () => {
      const i = input({
        treatments: [t({ everyHours: undefined })],
        treatmentDoses: { treatment1: { today: 1, lastAt: at(2026, 10, 31, 10, 5) } },
      });
      expect(staleDelivered(i, [treatmentId('treatment1', fireAt)], now)).toEqual([]);
    });
  });

  it('returns every stale identifier in one pass, preserving input order', () => {
    const fireAt = at(2026, 10, 31, 10, 15);
    const pump = pumpId(at(2026, 10, 31, 7), 1, at(2026, 10, 31, 10));
    const i = input({
      children: [rowan],
      asleepChildIds: { c1: true },
      timers: [],
      lastPumpAt: at(2026, 10, 31, 10, 20),
    });
    const ids = [staleId('t1', fireAt), `${REMINDER_PREFIX}due:c1:day:${fireAt}`, napId('c1', fireAt), pump];
    expect(staleDelivered(i, ids, now)).toEqual([staleId('t1', fireAt), napId('c1', fireAt), pump]);
  });
});
