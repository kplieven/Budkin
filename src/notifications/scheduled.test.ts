import { describe, expect, it } from 'vitest';

import {
  addDays,
  addMonths,
  AGE_HORIZON_MONTHS,
  AGE_STEPS,
  atReminderHour,
  desiredScheduled,
  diffScheduled,
  PUMP_AHEAD,
  REMINDER_PREFIX,
  STALE_AFTER_MIN,
  type ReminderPrefs,
  type ScheduleInput,
} from '@/notifications/scheduled';
import type { Child, Timer } from '@/types/models';

/** Local-time construction, so the 09:00 assertions hold in any timezone. */
const at = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime();

const prefs = (over: Partial<ReminderPrefs> = {}): ReminderPrefs => ({
  dueDateReminders: true,
  staleTimerReminders: true,
  ageMilestones: true,
  pumpingReminders: false,
  pumpingIntervalMin: 180,
  pumpingEnabledAt: null,
  napSuggestions: false,
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
    expect(out.every((n) => n.data.url === '/history')).toBe(true);
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
    expect(n.data.url).toBe('/timers');
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

  it('resolves an ownerless sleep timer to the selected child', () => {
    // A timer started from the headless widget carries no childId.
    const t = timer({ id: 't1', childId: undefined, saveAs: 'sleep' });
    expect(naps(napInput({ timers: [t], selectedChildId: 'c1' }))).toEqual([]);
    // ...and must not suppress a DIFFERENT child's nudge.
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
