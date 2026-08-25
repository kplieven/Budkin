/** Shaping and reconcile logic for SCHEDULED reminders. These outlive the
 *  process: the app can be killed for weeks while Android holds a pending alert,
 *  so the reconcile diffs against the OS's pending set, not a local `prev`. */

import { treatmentDosageLabel, TIME_OF_DAY_ORDER } from '@/features/treatments/treatmentLabels';
import { wakeWindowBand } from '@/features/insights/norms';
import { ACTIVITY_LABEL } from '@/lib/activities';
import { withChildParam } from '@/lib/deepLink';
import { fmtDur } from '@/lib/format';
import { catchUpDueAt, type MilestoneDef, MILESTONES } from '@/lib/milestones';
import { isTreatmentActiveToday, runningTimer, startOfDay, timeOfDaySlotMs } from '@/store/selectors';
import type { ActivityType, Child, Treatment, Timer } from '@/types/models';

/** Every identifier we own starts with this. `diffScheduled` refuses to cancel
 *  anything without it, so a timer notification (bare uuid) is never touched. */
export const REMINDER_PREFIX = 'budkin:';

export const REMINDER_HOUR = 9;

export const DUE_LEAD_DAYS = 7;

export type ReminderKind = 'due' | 'stale' | 'age' | 'pump' | 'nap' | 'treatment' | 'milestone';

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
  treatmentReminders: boolean;
  /** when the treatments toggle was last switched on, epoch ms */
  treatmentRemindersEnabledAt: number | null;
  milestoneCatchUp: boolean;
}

export interface ScheduleInput {
  children: Child[];
  timers: Timer[];
  prefs: ReminderPrefs;
  /** end (or start, when still running) of the most recent pumping entry */
  lastPumpAt: number | null;
  lastSleepEndByChild: Record<string, number>;
  /** Children with an ONGOING sleep entry, whether or not a running Timer also
   *  exists: an entry edited to "still ongoing" creates no Timer, and a server
   *  sleep record may have no end. */
  asleepChildIds: Record<string, true>;
  treatments: Treatment[];
  /** Per treatment id: doses since local midnight, and the last dose instant. */
  treatmentDoses: Record<string, { today: number; lastAt: number | null }>;
  reachedMilestoneKeysByChild: Record<string, readonly string[]>;
  answeredMilestoneKeysByChild: Record<string, readonly string[]>;
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

/** Clamps to a short month's last day: a birth on the 31st still gets April. */
export function addMonths(ms: number, n: number): number {
  const d = new Date(ms);
  const day = d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1, d.getHours(), d.getMinutes(), 0, 0);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target.getTime();
}

function dueReminders(child: Child, now: number): ScheduledNotification[] {
  // `birth` holds the DUE date while `expected` is true.
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
      data: { url: withChildParam('/', child.id) },
    });
  }
  if (day > now) {
    out.push({
      identifier: `${REMINDER_PREFIX}due:${child.id}:day:${day}`,
      kind: 'due',
      title: `Today is ${child.first}'s due date`,
      body: 'Tap when your baby arrives.',
      fireAt: day,
      data: { url: withChildParam('/', child.id) },
    });
  }
  return out;
}

/** Sleep is the widest on purpose: a 3am false alarm beats a late catch. */
export const STALE_AFTER_MIN: Record<ActivityType, number | null> = {
  tummy: 45,
  pumping: 120,
  feeding: 180,
  sleep: 840,
  diaper: null,
  bath: null,
  temperature: null,
  medication: null,
  note: null,
  milestone: null,
};

function spanLabel(min: number): string {
  if (min < 60) return `${min} minutes`;
  const h = min / 60;
  return h === 1 ? '1 hour' : `${h} hours`;
}

function staleReminders(timer: Timer, children: Child[], now: number): ScheduledNotification[] {
  const threshold = STALE_AFTER_MIN[timer.saveAs];
  if (threshold == null) return [];
  const fireAt = timer.start + threshold * 60_000;
  if (fireAt <= now) return [];
  const label = ACTIVITY_LABEL[timer.saveAs];
  const child = children.find((c) => c.id === timer.childId);
  return [
    {
      // Fire time in the identifier: editing a running timer's start moves the
      // alert without changing title or body, and the diff compares only those.
      identifier: `${REMINDER_PREFIX}stale:${timer.id}:${fireAt}`,
      kind: 'stale',
      title: child?.first ? `${child.first} · ${label}` : label,
      body: `Running for ${spanLabel(threshold)}. Still going?`,
      fireAt,
      // An unattributable timer names nobody rather than adopting the selection.
      data: { url: withChildParam('/timers', child?.id) },
    },
  ];
}

/** The obvious spine, roughly 1 / 2 / 4 / 6 / 9 / 12 months, is rejected: those
 *  are the vaccination dates, and an alert there reads as medical advice. */
export const AGE_STEPS: { slug: string; days?: number; months?: number; label: string }[] = [
  { slug: '1w', days: 7, label: 'one week' },
  { slug: '1m', months: 1, label: 'one month' },
  { slug: '3m', months: 3, label: 'three months' },
  { slug: '6m', months: 6, label: 'six months' },
  { slug: '9m', months: 9, label: 'nine months' },
];

export const AGE_HORIZON_MONTHS = 12;

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
      data: { url: withChildParam('/history', child.id) },
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

/** A repeating reminder built from one-shot triggers needs the app to reschedule
 *  after each fire; eight keeps the chain alive through roughly a day. */
export const PUMP_AHEAD = 8;

/** Not keyed on a child: pumping reminders are one global grid. Keyed on
 *  `saveAs`, never `activity`: `setTimerSaveAs` repoints a quick timer. */
function pumpingTimerRunning(timers: Timer[]): boolean {
  return timers.some((t) => t.saveAs === 'pumping');
}

function pumpReminders(input: ScheduleInput, now: number): ScheduledNotification[] {
  if (pumpingTimerRunning(input.timers)) return [];
  const { pumpingIntervalMin, pumpingEnabledAt } = input.prefs;
  const anchor = Math.max(input.lastPumpAt ?? 0, pumpingEnabledAt ?? 0);
  if (!anchor || pumpingIntervalMin <= 0) return [];
  const interval = pumpingIntervalMin * 60_000;
  // From `now`, not the anchor: a fully passed grid re-enters on phase.
  const first = Math.max(1, Math.ceil((now - anchor) / interval));
  const out: ScheduledNotification[] = [];
  for (let n = first; out.length < PUMP_AHEAD && n < first + PUMP_AHEAD + 1; n++) {
    const fireAt = anchor + n * interval;
    if (fireAt <= now) continue;
    out.push({
      // Fire time in the identifier, as in every kind here: title and body are
      // constant, so without it a changed pumpingIntervalMin recomputes fireAt
      // for the same anchor:n, the id (and the diff's verdict) does not change,
      // and Android's pending alarm stays pinned at the old spacing.
      identifier: `${REMINDER_PREFIX}pump:${anchor}:${n}:${fireAt}`,
      kind: 'pump',
      title: 'Time to pump',
      body: 'Tap to log a session.',
      fireAt,
      // The only childless kind by design: pumping is parent-side.
      data: { url: '/timers' },
    });
  }
  return out;
}

/** Firing AT the band's upper bound would announce the parent is already late. */
export const NAP_LEAD_MIN = 15;

export const NAP_DAY_START_HOUR = 7;
export const NAP_DAY_END_HOUR = 19;

const DAY_MS = 86_400_000;

function withinNapHours(ms: number): boolean {
  const h = new Date(ms).getHours();
  return h >= NAP_DAY_START_HOUR && h < NAP_DAY_END_HOUR;
}

/** The only reminder that gives ADVICE rather than reporting a fact, and on a
 *  rule of thumb, not medical consensus. Hence it ships off. */
function napReminders(child: Child, input: ScheduleInput, now: number): ScheduledNotification[] {
  if (child.expected) return [];
  // Straight division rather than `addDays` (unlike the rest of this file) is
  // fine here: an hour of DST drift only matters within an hour of a band edge.
  const band = wakeWindowBand((now - child.birth) / DAY_MS);
  if (band?.hi == null) return [];

  // A running sleep TIMER and, separately, an ongoing sleep ENTRY with no timer.
  const asleep =
    runningTimer(input.timers, 'sleep', child.id) != null ||
    input.asleepChildIds[child.id] === true;
  if (asleep) return [];

  const wokeAt = input.lastSleepEndByChild[child.id];
  if (wokeAt == null) return [];

  const awakeMin = band.hi - NAP_LEAD_MIN;
  const fireAt = wokeAt + awakeMin * 60_000;
  if (fireAt <= now) return [];
  // Dropped, NOT deferred: a window that elapses at 21:00 means nothing by 07:00.
  if (!withinNapHours(fireAt)) return [];

  return [
    {
      // Fire time in the id: logging a sleep moves the anchor, not the copy.
      identifier: `${REMINDER_PREFIX}nap:${child.id}:${fireAt}`,
      kind: 'nap',
      title: `${child.first} may be ready for a nap`,
      // `spanLabel` assumes whole hours and would render this as "1.25 hours".
      body: `Awake ${fmtDur(awakeMin)}.`,
      fireAt,
      data: { url: withChildParam('/timers', child.id) },
    },
  ];
}

/** An occurrence count rather than a day count bounds the OS queue. */
export const TREATMENT_AHEAD = 8;

export const TREATMENT_MAX_DAYS = 14;

function treatmentNote(treatment: Treatment, child: Child, fireAt: number): ScheduledNotification {
  const dosage = treatmentDosageLabel(treatment);
  return {
    // Keyed on the id, not the name: a rename must not orphan pending alerts.
    identifier: `${REMINDER_PREFIX}treatment:${treatment.id}:${fireAt}`,
    kind: 'treatment',
    // The child is named unconditionally: a title that varied with unrelated
    // state would have `diffScheduled` rewrite every pending alert.
    title: `${child.first} · ${treatment.name.trim()} due`,
    body: dosage || 'Tap to log the dose.',
    fireAt,
    data: { url: withChildParam(`/log/medication?treatment=${encodeURIComponent(treatment.id)}`, treatment.childId) },
  };
}

/** Each slot's instant is built off THAT day's own midnight with setHours, never
 *  as midnight plus n * 86_400_000, so DST cannot move the 08:00 dose. */
function treatmentTimesOfDayReminders(
  treatment: Treatment,
  child: Child,
  input: ScheduleInput,
  now: number,
  todayMidnight: number,
): ScheduledNotification[] {
  const slots = TIME_OF_DAY_ORDER.filter((tod) => treatment.timesOfDay?.includes(tod));
  const dosesToday = input.treatmentDoses[treatment.id]?.today ?? 0;
  const out: ScheduledNotification[] = [];
  for (let day = 0; day < TREATMENT_MAX_DAYS && out.length < TREATMENT_AHEAD; day++) {
    const dayMidnight = addDays(todayMidnight, day);
    // toDate is stored at local midnight and is inclusive.
    if (treatment.toDate != null && dayMidnight > treatment.toDate) break;
    for (let k = 0; k < slots.length && out.length < TREATMENT_AHEAD; k++) {
      // TODAY ONLY: the kth slot (counted from the start of the day) is settled
      // once k doses are logged. Counting, not matching slot to dose, is what
      // makes a late dose behave.
      if (day === 0 && dosesToday >= k + 1) continue;
      const fireAt = timeOfDaySlotMs(dayMidnight, slots[k]);
      if (fireAt <= now) continue;
      out.push(treatmentNote(treatment, child, fireAt));
    }
  }
  return out;
}

/** Re-anchors on every logged dose, so the way to fix a drifting reminder is to
 *  log one, including after the fact. */
function treatmentEveryHoursReminders(
  treatment: Treatment,
  child: Child,
  input: ScheduleInput,
  now: number,
): ScheduledNotification[] {
  if (treatment.everyHours == null || treatment.everyHours <= 0) return [];

  const lastDoseAt = input.treatmentDoses[treatment.id]?.lastAt ?? null;
  // This null check must come BEFORE the Math.max below: pumpReminders' plain
  // Math.max would manufacture a grid for a treatment never dosed.
  if (lastDoseAt == null) return [];
  const anchor = Math.max(lastDoseAt, input.prefs.treatmentRemindersEnabledAt ?? 0);

  const interval = treatment.everyHours * 3_600_000;
  // toDate is inclusive; addDays keeps the +1 correct across a DST boundary.
  const endsAt = treatment.toDate != null ? addDays(treatment.toDate, 1) : null;
  // From `now`, not the anchor, so a fully passed grid re-enters on phase.
  const first = Math.max(1, Math.ceil((now - anchor) / interval));
  const out: ScheduledNotification[] = [];
  for (let n = first; out.length < TREATMENT_AHEAD && n < first + TREATMENT_AHEAD + 1; n++) {
    const fireAt = anchor + n * interval;
    if (fireAt <= now) continue;
    if (endsAt != null && fireAt >= endsAt) break;
    out.push(treatmentNote(treatment, child, fireAt));
  }
  return out;
}

function treatmentReminders(input: ScheduleInput, now: number): ScheduledNotification[] {
  const todayMidnight = startOfDay(now);
  const out: ScheduledNotification[] = [];
  for (const treatment of input.treatments) {
    const child = input.children.find((c) => c.id === treatment.childId);
    if (!child) continue;
    // `resolveLogDeepLink` refuses an expected child, so the alert's own tap
    // target would refuse it.
    if (child.expected) continue;
    // Covers the paused flag and the fromDate/toDate range too.
    if (!isTreatmentActiveToday(treatment, todayMidnight, treatment.childId)) continue;
    // `logMedicationFromTreatment` gates on the name too: this would be a dead tap.
    if (!treatment.name.trim()) continue;
    // As-needed: never reminded, since there is no schedule to be late against - only
    // a cooldown that gates the NEXT dose, surfaced at log time instead.
    if (treatment.scheduleMode === 'sporadic') continue;
    out.push(
      ...(treatment.scheduleMode === 'everyHours'
        ? treatmentEveryHoursReminders(treatment, child, input, now)
        : treatmentTimesOfDayReminders(treatment, child, input, now, todayMidnight)),
    );
  }
  return out;
}

/** The scheduled twin of the `MilestoneNudge` card: both derive "due" from
 *  `catchUpDueAt`, and answering the card retires the alert. */
function milestoneReminders(
  child: Child,
  input: ScheduleInput,
  now: number,
): ScheduledNotification[] {
  // `birth` holds a DUE date while expecting, so there is no age to measure yet.
  if (child.expected) return [];

  const horizon = addMonths(now, AGE_HORIZON_MONTHS);
  const done = new Set([
    ...(input.reachedMilestoneKeysByChild[child.id] ?? []),
    ...(input.answeredMilestoneKeysByChild[child.id] ?? []),
  ]);

  // Several windows close at the same age, and one alert each would burst.
  const byFireAt = new Map<number, MilestoneDef[]>();
  for (const m of MILESTONES) {
    if (done.has(m.key)) continue;
    const due = catchUpDueAt(child.birth, m);
    // `atReminderHour` moves BACK to 09:00 of the containing day, which can land
    // before `due`. The following morning keeps the alert behind the card.
    const sameDay = atReminderHour(due);
    const fireAt = sameDay >= due ? sameDay : atReminderHour(addDays(due, 1));
    if (fireAt <= now || fireAt > horizon) continue;
    const group = byFireAt.get(fireAt);
    if (group) group.push(m);
    else byFireAt.set(fireAt, [m]);
  }

  const out: ScheduledNotification[] = [];
  for (const [fireAt, defs] of byFireAt) {
    const single = defs.length === 1;
    out.push({
      // The keys ride in the identifier so logging one milestone out of a batch
      // yields a DIFFERENT id, which `diffScheduled` cancels and replaces.
      identifier: `${REMINDER_PREFIX}milestone:${child.id}:${defs.map((d) => d.key).join(',')}:${fireAt}`,
      kind: 'milestone',
      title: single
        ? `A milestone to check for ${child.first}.`
        : `${defs.length} milestones to check for ${child.first}.`,
      body: single
        ? `${defs[0].title}. Most babies do this by ${defs[0].maxMonths} months.`
        : `${defs.map((d) => d.title).join(', ')}.`,
      fireAt,
      data: { url: withChildParam('/milestones', child.id) },
    });
  }
  return out;
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
  if (input.prefs.treatmentReminders) {
    out.push(...treatmentReminders(input, now));
  }
  if (input.prefs.milestoneCatchUp) {
    for (const c of input.children) out.push(...milestoneReminders(c, input, now));
  }
  return out;
}

/** Diff the desired set against what the OS holds. There is no update call: a
 *  pending notification whose title or body changed (a renamed child) is
 *  cancelled and rescheduled. Anything without our prefix is invisible here. */
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

interface ParsedReminderId {
  kind: string;
  /** everything between the kind and the trailing fire time */
  head: string;
  fireAt: number;
}

/** Split `budkin:{kind}:{head}:{fireAt}` apart. The fire time is read off the
 *  END, not by position: `head` may itself contain colons. */
function parseReminderId(id: string): ParsedReminderId | null {
  const rest = id.slice(REMINDER_PREFIX.length);
  const kindEnd = rest.indexOf(':');
  if (kindEnd <= 0) return null;
  const tail = rest.slice(kindEnd + 1);
  const fireAtStart = tail.lastIndexOf(':');
  if (fireAtStart <= 0) return null;
  const fireAt = Number(tail.slice(fireAtStart + 1));
  if (!Number.isFinite(fireAt)) return null;
  return { kind: rest.slice(0, kindEnd), head: tail.slice(0, fireAtStart), fireAt };
}

/** Whether the dose an already-delivered alert asked for has been given.
 *  Attribution is by trimmed, case-insensitive NAME, because a `MedicationEntry`
 *  carries no treatment reference that survives sync. Answers "not given"
 *  whenever it cannot answer confidently. */
function treatmentDoseGiven(
  input: ScheduleInput,
  treatmentId: string,
  fireAt: number,
  now: number,
): boolean {
  const treatment = input.treatments.find((t) => t.id === treatmentId);
  if (!treatment) return false;
  const doses = input.treatmentDoses[treatment.id];
  if (!doses) return false;

  if (treatment.scheduleMode === 'everyHours') {
    if (treatment.everyHours == null || treatment.everyHours <= 0) return false;
    return doses.lastAt != null && now < doses.lastAt + treatment.everyHours * 3_600_000;
  }

  const todayMidnight = startOfDay(now);
  // A banner from an earlier day: `today` says nothing about a day already over.
  if (fireAt < todayMidnight) return false;
  const slots = TIME_OF_DAY_ORDER.filter((tod) => treatment.timesOfDay?.includes(tod));
  const k = slots.findIndex((tod) => timeOfDaySlotMs(todayMidnight, tod) === fireAt);
  if (k < 0) return false;
  // The forward suppression above, backwards: the kth slot today (0-based) is
  // settled once k + 1 doses are logged today.
  return doses.today >= k + 1;
}

function isStaleDelivered(parsed: ParsedReminderId, input: ScheduleInput, now: number): boolean {
  switch (parsed.kind) {
    case 'nap':
      return (
        runningTimer(input.timers, 'sleep', parsed.head) != null ||
        input.asleepChildIds[parsed.head] === true
      );
    case 'stale':
      return !input.timers.some((t) => t.id === parsed.head);
    case 'pump':
      // `lastPumpAt` anchors the grid too, so the halves cannot disagree.
      return (
        pumpingTimerRunning(input.timers) ||
        (input.lastPumpAt != null && input.lastPumpAt >= parsed.fireAt)
      );
    case 'treatment':
      return treatmentDoseGiven(input, parsed.head, parsed.fireAt, now);
    default:
      // `due`, `age` and `milestone` report a calendar fact that stays true
      // after firing. New kinds land here too, and staying is the safe default.
      return false;
  }
}

/**
 * Which DELIVERED notifications should be swept out of the tray.
 * `cancelScheduledNotificationAsync` only ever reaches PENDING alerts, and a
 * notification leaves the pending set the moment it fires, so a banner in the
 * shade is invisible to `diffScheduled`. Condition-driven, NOT
 * desired-set-driven: every builder above drops an occurrence once
 * `fireAt <= now`, so "dismiss what is no longer desired" would clear every
 * banner on arrival.
 */
export function staleDelivered(
  input: ScheduleInput,
  presentedIds: readonly string[],
  now: number,
): string[] {
  const out: string[] = [];
  for (const id of presentedIds) {
    if (!id.startsWith(REMINDER_PREFIX)) continue;
    const parsed = parseReminderId(id);
    if (parsed && isStaleDelivered(parsed, input, now)) out.push(id);
  }
  return out;
}
