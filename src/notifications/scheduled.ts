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

import { ACTIVITY_LABEL } from '@/lib/activities';
import type { ActivityType, Child, Timer } from '@/types/models';

/** Every identifier we own starts with this. `diffScheduled` refuses to cancel
 *  anything without it, so a timer notification (bare uuid) is never touched. */
export const REMINDER_PREFIX = 'budkin:';

/** Local hour for due-date and age reminders. Fixed, not a user setting. */
export const REMINDER_HOUR = 9;

/** Days before the due date for the lead-up reminder. */
export const DUE_LEAD_DAYS = 7;

export type ReminderKind = 'due' | 'stale' | 'age' | 'pump';

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
}

/** A narrow projection of the store, so this layer never imports store types. */
export interface ScheduleInput {
  children: Child[];
  timers: Timer[];
  prefs: ReminderPrefs;
  /** end (or start, when still running) of the most recent pumping entry */
  lastPumpAt: number | null;
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

export function desiredScheduled(input: ScheduleInput, now: number): ScheduledNotification[] {
  const out: ScheduledNotification[] = [];
  if (input.prefs.dueDateReminders) {
    for (const c of input.children) out.push(...dueReminders(c, now));
  }
  if (input.prefs.staleTimerReminders) {
    for (const t of input.timers) out.push(...staleReminders(t, input.children, now));
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
