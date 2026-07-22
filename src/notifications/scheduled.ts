/**
 * Pure shaping + reconcile logic for SCHEDULED reminders (due date, stale
 * timers, age milestones, pumping). No native calls and no I/O, so it is
 * trivially unit-testable.
 *
 * The twin of `content.ts`, with one important difference. `content.ts` drives
 * IMMEDIATE notifications and `sync.ts` can diff against an in-memory `prev`,
 * because those are re-derived on every launch. These outlive the process: the
 * app can be killed for weeks while Android still holds a pending due-date
 * alert. So the reconcile reads the OS's pending set and diffs against THAT.
 */

import { wakeWindowBand } from '@/features/insights/norms';
import { ACTIVITY_LABEL } from '@/lib/activities';
import { fmtDur } from '@/lib/format';
import type { ActivityType, Child, Timer } from '@/types/models';

/** Every identifier we own starts with this. `diffScheduled` refuses to cancel
 *  anything without it, so a timer notification (bare uuid) is never touched. */
export const REMINDER_PREFIX = 'budkin:';

/** Local hour for due-date and age reminders. Fixed, not a user setting. */
export const REMINDER_HOUR = 9;

/** Days before the due date for the lead-up reminder. */
export const DUE_LEAD_DAYS = 7;

export type ReminderKind = 'due' | 'stale' | 'age' | 'pump' | 'nap';

export interface ScheduledNotification {
  /** stable, and encodes the fire time so a moved date yields a new id */
  identifier: string;
  kind: ReminderKind;
  title: string;
  body: string;
  /** epoch ms */
  fireAt: number;
  data: { url: string };
}

/** What the OS reports as pending. Only the fields the diff compares. */
export interface ExistingNotification {
  identifier: string;
  title: string;
  body: string;
}

export interface ReminderPrefs {
  dueDateReminders: boolean;
  staleTimerReminders: boolean;
  ageMilestones: boolean;
  pumpingReminders: boolean;
  pumpingIntervalMin: number;
  /** when the pumping toggle was last switched on, epoch ms */
  pumpingEnabledAt: number | null;
  napSuggestions: boolean;
}

/** A narrow projection of the store, so this layer never imports store types. */
export interface ScheduleInput {
  children: Child[];
  timers: Timer[];
  prefs: ReminderPrefs;
  /** end (or start, when still running) of the most recent pumping entry */
  lastPumpAt: number | null;
  /** Per child, the end of their most recent ENDED sleep entry. The instant
   *  the current wake window started. Absent when they have never slept on
   *  record. */
  lastSleepEndByChild: Record<string, number>;
  /** Resolves a running timer that carries no `childId` (one started from the
   *  headless widget). Mirrors `useAppStore.ts:600`. */
  selectedChildId: string;
}

/** 09:00 local on the calendar day containing `ms`. Built from local Y/M/D
 *  rather than by adding milliseconds, so DST cannot shift the hour. */
export function atReminderHour(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), REMINDER_HOUR, 0, 0, 0).getTime();
}

/** Calendar day arithmetic. A 23- or 25-hour DST day would break `n * 86400000`. */
export function addDays(ms: number, n: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), 0, 0).getTime();
}

/** Calendar month arithmetic, clamping to the last day of a short target month
 *  so a birth on the 31st still gets a 3-month milestone in April. */
export function addMonths(ms: number, n: number): number {
  const d = new Date(ms);
  const day = d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1, d.getHours(), d.getMinutes(), 0, 0);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target.getTime();
}

function dueReminders(child: Child, now: number): ScheduledNotification[] {
  // `birth` holds the DUE date while `expected` is true. See Child in models.ts.
  if (!child.expected) return [];
  const out: ScheduledNotification[] = [];
  const lead = atReminderHour(addDays(child.birth, -DUE_LEAD_DAYS));
  const day = atReminderHour(child.birth);
  if (lead > now) {
    out.push({
      identifier: `${REMINDER_PREFIX}due:${child.id}:lead:${lead}`,
      kind: 'due',
      title: `${child.first} is due next week`,
      body: 'Budkin is ready when they are.',
      fireAt: lead,
      data: { url: '/' },
    });
  }
  if (day > now) {
    out.push({
      identifier: `${REMINDER_PREFIX}due:${child.id}:day:${day}`,
      kind: 'due',
      title: `Today is ${child.first}'s due date`,
      body: 'Tap when your baby arrives.',
      fireAt: day,
      data: { url: '/' },
    });
  }
  return out;
}

/**
 * How long a running timer may go before we suspect it was forgotten. Only the
 * four interval-shaped activities can run a timer; the rest are `null`.
 *
 * Sleep is deliberately the widest: a night sleep entry legitimately runs
 * twelve hours, and a false alarm at 3am is far worse than a late catch.
 */
export const STALE_AFTER_MIN: Record<ActivityType, number | null> = {
  tummy: 45,
  pumping: 120,
  feeding: 180,
  sleep: 840,
  diaper: null,
  bath: null,
  temperature: null,
  note: null,
  milestone: null,
};

/** "45 minutes", "3 hours". Every STALE_AFTER_MIN value is a whole number of
 *  hours or under an hour, so no mixed "1 hour 30" case can arise. */
function spanLabel(min: number): string {
  if (min < 60) return `${min} minutes`;
  const h = min / 60;
  return h === 1 ? '1 hour' : `${h} hours`;
}

function staleReminders(timer: Timer, children: Child[], now: number): ScheduledNotification[] {
  const threshold = STALE_AFTER_MIN[timer.saveAs];
  if (threshold == null) return [];
  const fireAt = timer.start + threshold * 60_000;
  // Already past: if the app was closed, the OS fired the alert scheduled when
  // the timer started. Nothing to do.
  if (fireAt <= now) return [];
  const label = ACTIVITY_LABEL[timer.saveAs];
  const child = children.find((c) => c.id === timer.childId);
  return [
    {
      // The fire time is in the identifier because editing a running timer's
      // start moves the alert without changing the title or body, and the diff
      // compares only those two.
      identifier: `${REMINDER_PREFIX}stale:${timer.id}:${fireAt}`,
      kind: 'stale',
      title: child?.first ? `${child.first} · ${label}` : label,
      body: `Running for ${spanLabel(threshold)}. Still going?`,
      fireAt,
      data: { url: '/timers' },
    },
  ];
}

/**
 * Age milestones worth a notification, and their copy.
 *
 * Quarterly after the first month, so the parent gets a pattern they can
 * anticipate. The obvious alternative spine, roughly 1 / 2 / 4 / 6 / 9 / 12
 * months, is rejected on purpose: those are the well-baby visit and vaccination
 * dates, and a notification landing on them invites a parent to read it as a
 * reminder about an appointment. That is a medical implication the app has not
 * earned. Keep this cadence, and keep the copy celebratory.
 */
export const AGE_STEPS: { slug: string; days?: number; months?: number; label: string }[] = [
  { slug: '1w', days: 7, label: 'one week' },
  { slug: '1m', months: 1, label: 'one month' },
  { slug: '3m', months: 3, label: 'three months' },
  { slug: '6m', months: 6, label: 'six months' },
  { slug: '9m', months: 9, label: 'nine months' },
];

/** Only occurrences this far ahead are scheduled. Each launch extends it. */
export const AGE_HORIZON_MONTHS = 12;

/** Highest birthday we will ever schedule, a loop bound rather than a policy. */
const MAX_BIRTHDAY_YEAR = 25;

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function ageReminders(child: Child, now: number): ScheduledNotification[] {
  // `birth` holds a DUE date while expecting, so there is no age to celebrate.
  if (child.expected) return [];
  const horizon = addMonths(now, AGE_HORIZON_MONTHS);
  const out: ScheduledNotification[] = [];

  const push = (slug: string, fireAt: number, title: string) => {
    if (fireAt <= now || fireAt > horizon) return;
    out.push({
      identifier: `${REMINDER_PREFIX}age:${child.id}:${slug}:${fireAt}`,
      kind: 'age',
      title,
      body: 'Tap to look back.',
      fireAt,
      data: { url: '/history' },
    });
  };

  for (const step of AGE_STEPS) {
    const on =
      step.days != null ? addDays(child.birth, step.days) : addMonths(child.birth, step.months ?? 0);
    push(step.slug, atReminderHour(on), `${child.first} is ${step.label} old today.`);
  }

  for (let y = 1; y <= MAX_BIRTHDAY_YEAR; y++) {
    const fireAt = atReminderHour(addMonths(child.birth, y * 12));
    if (fireAt > horizon) break;
    const title =
      y === 1
        ? `Happy first birthday, ${child.first}.`
        : `Happy ${ordinal(y)} birthday, ${child.first}.`;
    push(`${y}y`, fireAt, title);
  }

  return out;
}

/** How many pumping occurrences to schedule ahead. A repeating reminder built
 *  from one-shot triggers needs the app to reschedule after each fire; eight
 *  keeps the chain alive through roughly a day of the app never coming to the
 *  foreground. A foreground resume reconciles too (`reconcileNow` in
 *  scheduleSync.ts, called from `_layout.tsx`'s AppState handler), not only a
 *  gated store write, so this margin only has to cover the gap between
 *  foregrounds, not between writes specifically. */
export const PUMP_AHEAD = 8;

/**
 * Repeating reminder on a fixed interval, anchored to the last pumping entry
 * (or, before any entry exists, to when the toggle was switched on). Unlike
 * the other three kinds, this one is not a fixed calendar instant: it is a
 * grid of occurrences `n * interval` past the anchor, and several are
 * scheduled ahead so the chain survives the app never being reopened.
 */
function pumpReminders(input: ScheduleInput, now: number): ScheduledNotification[] {
  const { pumpingIntervalMin, pumpingEnabledAt } = input.prefs;
  const anchor = Math.max(input.lastPumpAt ?? 0, pumpingEnabledAt ?? 0);
  if (!anchor || pumpingIntervalMin <= 0) return [];
  const interval = pumpingIntervalMin * 60_000;
  // Deriving the first occurrence from `now` rather than blindly from the
  // anchor is what makes this self-healing: if every scheduled occurrence has
  // already passed, we re-enter the grid on phase instead of scheduling
  // nothing. The grid stays anchored, so identifiers only churn when an
  // occurrence actually passes.
  const first = Math.max(1, Math.ceil((now - anchor) / interval));
  const out: ScheduledNotification[] = [];
  for (let n = first; out.length < PUMP_AHEAD && n < first + PUMP_AHEAD + 1; n++) {
    const fireAt = anchor + n * interval;
    if (fireAt <= now) continue;
    out.push({
      // The fire time is in the identifier, matching the other three kinds,
      // because title and body are constant ('Time to pump' every time) so
      // they carry no signal that the interval changed. Without fireAt here, a
      // changed pumpingIntervalMin recomputes fireAt for the same anchor:n but
      // leaves the identifier (and therefore the diff's verdict) unchanged, so
      // Android's already-pending alarm stays pinned at the old spacing. It is
      // still stable while now advances: fireAt is anchor + n * interval, which
      // only moves when the anchor or interval actually moves.
      identifier: `${REMINDER_PREFIX}pump:${anchor}:${n}:${fireAt}`,
      kind: 'pump',
      title: 'Time to pump',
      // Deliberately no elapsed time: occurrence n fires n * interval after the
      // last pump, so a fixed "last pumped 3 hours ago" would be wrong for
      // every occurrence after the first.
      body: 'Tap to log a session.',
      fireAt,
      data: { url: '/timers' },
    });
  }
  return out;
}

/** Minutes before the band's upper bound that the nudge fires. Firing AT the
 *  bound would announce the parent is already late, and the overtired window
 *  has arrived by then. */
export const NAP_LEAD_MIN = 15;

/** Local hours the nudge may fire in. The same boundary `sleepTimer.ts` uses
 *  to default a sleep entry's `nap` flag, so "nap" means one thing app-wide. */
export const NAP_DAY_START_HOUR = 7;
export const NAP_DAY_END_HOUR = 19;

const DAY_MS = 86_400_000;

function withinNapHours(ms: number): boolean {
  const h = new Date(ms).getHours();
  return h >= NAP_DAY_START_HOUR && h < NAP_DAY_END_HOUR;
}

/**
 * Suggests a nap as the child nears the upper end of the typical wake window
 * for their age, anchored to the end of their last sleep.
 *
 * The only reminder here that gives ADVICE rather than reporting a fact, and
 * it is built on a rule of thumb the app itself labels as not medical
 * consensus (see NORMS.wakeWindow). Hence the hedged title, the body that
 * states the observation instead of an instruction, and the preference that
 * ships off.
 */
function napReminders(child: Child, input: ScheduleInput, now: number): ScheduledNotification[] {
  // `birth` holds a DUE date while expecting, so there is no age.
  if (child.expected) return [];
  // Null past the age the source covers, rather than extrapolating forever.
  const band = wakeWindowBand((now - child.birth) / DAY_MS);
  if (band?.hi == null) return [];

  // Asleep right now, so there is nothing to suggest. A timer started from the
  // headless widget carries no childId and belongs to the selected child.
  const asleep = input.timers.some(
    (t) => t.saveAs === 'sleep' && (t.childId ?? input.selectedChildId) === child.id,
  );
  if (asleep) return [];

  const wokeAt = input.lastSleepEndByChild[child.id];
  if (wokeAt == null) return [];

  const awakeMin = band.hi - NAP_LEAD_MIN;
  const fireAt = wokeAt + awakeMin * 60_000;
  if (fireAt <= now) return [];
  // Dropped, NOT deferred to the morning: a window that elapses at 21:00 is
  // meaningless by 07:00, because the baby has slept the night in between and
  // the anchor that justified it is stale.
  if (!withinNapHours(fireAt)) return [];

  return [
    {
      // The fire time is in the identifier, as with pump: logging a sleep
      // moves the anchor, and title/body alone carry too little signal for the
      // diff to notice.
      identifier: `${REMINDER_PREFIX}nap:${child.id}:${fireAt}`,
      kind: 'nap',
      // Hedged on purpose. The app has a population rule of thumb; the parent
      // has an actual baby in front of them.
      title: `${child.first} may be ready for a nap`,
      // `spanLabel` above assumes whole hours and would render this as
      // "1.25 hours". fmtDur gives "1h 15m".
      body: `Awake ${fmtDur(awakeMin)}.`,
      fireAt,
      data: { url: '/timers' },
    },
  ];
}

export function desiredScheduled(input: ScheduleInput, now: number): ScheduledNotification[] {
  const out: ScheduledNotification[] = [];
  if (input.prefs.dueDateReminders) {
    for (const c of input.children) out.push(...dueReminders(c, now));
  }
  if (input.prefs.staleTimerReminders) {
    for (const t of input.timers) out.push(...staleReminders(t, input.children, now));
  }
  if (input.prefs.ageMilestones) {
    for (const c of input.children) out.push(...ageReminders(c, now));
  }
  if (input.prefs.pumpingReminders) {
    out.push(...pumpReminders(input, now));
  }
  if (input.prefs.napSuggestions) {
    for (const c of input.children) out.push(...napReminders(c, input, now));
  }
  return out;
}

/**
 * Diff the desired set against what the OS already holds. A pending
 * notification is rescheduled when its title or body changed (a renamed child),
 * and cancelled when it left the desired set. Anything without our prefix is
 * invisible to both halves.
 */
export function diffScheduled(
  existing: ExistingNotification[],
  desired: ScheduledNotification[],
): { toSchedule: ScheduledNotification[]; toCancel: string[] } {
  const ours = existing.filter((e) => e.identifier.startsWith(REMINDER_PREFIX));
  const byId = new Map(ours.map((e) => [e.identifier, e]));
  const desiredIds = new Set(desired.map((d) => d.identifier));
  const toSchedule = desired.filter((d) => {
    const p = byId.get(d.identifier);
    return !p || p.title !== d.title || p.body !== d.body;
  });
  const toCancel = ours.filter((e) => !desiredIds.has(e.identifier)).map((e) => e.identifier);
  return { toSchedule, toCancel };
}
