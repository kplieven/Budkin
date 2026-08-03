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

/** Local hour for due-date and age reminders. Fixed, not a user setting. */
export const REMINDER_HOUR = 9;

/** Days before the due date for the lead-up reminder. */
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
  treatmentReminders: boolean;
  /** when the treatments toggle was last switched on, epoch ms */
  treatmentRemindersEnabledAt: number | null;
  milestoneCatchUp: boolean;
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
  /** Children with an ONGOING sleep entry (`end == null`), whether or not a
   *  running Timer also exists for them. Covers a sleep entry that is asleep
   *  right now with no timer to catch it: one edited to "still ongoing"
   *  (writes `end: null`, creates no Timer), or a server sleep record with no
   *  end. `napReminders` treats membership here exactly like a running sleep
   *  timer. */
  asleepChildIds: Record<string, true>;
  /** Every treatment the store holds. `treatmentReminders` covers each of them
   *  against its own child, as of 0.15.2. It was scoped to the selected child
   *  before that: forced until 0.15.0 (a server load held only the child the
   *  last fetch asked for, so a sibling's dose history read as empty), then
   *  merely narrow until the product decision was made. */
  treatments: Treatment[];
  /** Per treatment id: doses logged since local midnight, and the most recent dose
   *  instant. Derived scalars rather than raw entries, matching `lastPumpAt` and
   *  `lastSleepEndByChild`, so this file stays ignorant of `Entry`. Built by
   *  `treatmentDoseScalars`, which owns the by-name dose attribution rule. */
  treatmentDoses: Record<string, { today: number; lastAt: number | null }>;
  /** Per child, the catalog keys that child has already logged a milestone
   *  entry for. Per child rather than one list since 0.15.2: the catch-up nudge
   *  covers every child, and one list could only ever answer for one of them,
   *  which read every sibling as having reached nothing. Plain keys rather than
   *  entries, so this file stays ignorant of `Entry`. Sparse: a child with
   *  nothing logged has no key, which reads correctly as "reached nothing". */
  reachedMilestoneKeysByChild: Record<string, readonly string[]>;
  /** Per child, the catalog keys whose home-screen catch-up nudge that child's
   *  parent has already answered (yes, not yet, or dismissed). Persisted by
   *  src/data/milestonePrompts.ts, which already stores it keyed by child, so
   *  this is that map passed straight through. */
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
      // Every reminder names the child it is about, so the tap selects them
      // before it lands. See `childToSelectOnOpen`.
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
  medication: null,
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
      // `child` is the timer's OWN child and may be missing: an unattributable
      // timer names nobody rather than adopting the selection, exactly as the
      // title above does.
      data: { url: withChildParam('/timers', child?.id) },
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

/** How many pumping occurrences to schedule ahead. A repeating reminder built
 *  from one-shot triggers needs the app to reschedule after each fire; eight
 *  keeps the chain alive through roughly a day of the app never coming to the
 *  foreground. A foreground resume reconciles too (`reconcileNow` in
 *  scheduleSync.ts, called from `_layout.tsx`'s AppState handler), not only a
 *  gated store write, so this margin only has to cover the gap between
 *  foregrounds, not between writes specifically. */
export const PUMP_AHEAD = 8;

/**
 * Whether a pumping session is running right now.
 *
 * NOT keyed on a child, unlike the sleep check in `napReminders`, and that
 * asymmetry is deliberate. Pumping reminders are a single global grid anchored
 * on `lastPumpAt`, which `scheduleSync`'s `toInput` derives from every pumping
 * entry with no child filter at all. Scoping the suppression per child would
 * let the two halves of the same reminder disagree: a session logged against a
 * sibling would move the anchor but not silence the nudge.
 *
 * Keyed on `saveAs`, never `activity`, for the reason `runningTimer` documents:
 * `setTimerSaveAs` repoints a quick timer without touching `activity`, so an
 * `activity`-keyed check cannot see a timer that will be written as a pumping
 * session.
 */
function pumpingTimerRunning(timers: Timer[]): boolean {
  return timers.some((t) => t.saveAs === 'pumping');
}

/**
 * Repeating reminder on a fixed interval, anchored to the last pumping entry
 * (or, before any entry exists, to when the toggle was switched on). Unlike
 * the other three kinds, this one is not a fixed calendar instant: it is a
 * grid of occurrences `n * interval` past the anchor, and several are
 * scheduled ahead so the chain survives the app never being reopened.
 */
function pumpReminders(input: ScheduleInput, now: number): ScheduledNotification[] {
  // Mid-session, so there is nothing to ask for. The same shape of rule
  // `napReminders` applies while the child is asleep, and self-healing for the
  // same reason: stopping the timer writes a pumping entry, that moves
  // `lastPumpAt`, and the store write triggers a reconcile that rebuilds the
  // grid from the new anchor.
  if (pumpingTimerRunning(input.timers)) return [];
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
      // The only kind that is childless BY DESIGN: pumping is parent-side,
      // scheduled once for the device rather than per child, so there is nobody
      // to name. A stale-timer alert can be childless too, but only when the
      // timer it is about has no owner to resolve.
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
  // The straight division (not `addDays`, unlike the rest of this file) is
  // fine here: an hour of DST drift only matters within an hour of a
  // 30/90/180/365-day bucket edge, where the difference is 15 minutes of
  // awake time, and it matches how `bandForRange` in norms.ts computes age.
  const band = wakeWindowBand((now - child.birth) / DAY_MS);
  if (band?.hi == null) return [];

  // Asleep right now, so there is nothing to suggest. Covers a running sleep
  // TIMER, and separately an ongoing sleep ENTRY that carries no timer at all
  // (`asleepChildIds`; see its doc comment on ScheduleInput) — a running timer
  // does not exist for every ongoing sleep, e.g. one edited to "still
  // ongoing". `runningTimer` is the shared rule, asked about THIS child: a
  // timer belongs to whoever started it, so one child falling asleep can never
  // silence another's nudge, and a timer with no owner at all silences nobody's.
  const asleep =
    runningTimer(input.timers, 'sleep', child.id) != null ||
    input.asleepChildIds[child.id] === true;
  if (asleep) return [];

  // Documents the precondition rather than enforcing it: without this, wokeAt
  // is undefined, fireAt is NaN, and `fireAt <= now` then `withinNapHours`
  // both reject a NaN anyway, so no test can tell this guard apart from its
  // absence. Keep it regardless, so a later reorder of the checks below can't
  // silently make NaN-propagation load-bearing with nothing testing it.
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
      data: { url: withChildParam('/timers', child.id) },
    },
  ];
}

/**
 * How many occurrences to schedule ahead PER TREATMENT, in both schedule modes. Same
 * reasoning as PUMP_AHEAD: a repeating reminder built from one-shot triggers
 * needs the app to reschedule after each fire, and this margin keeps the chain
 * alive between foregrounds.
 *
 * A per-treatment occurrence count rather than a fixed number of days, which gives
 * sparse schedules more lookahead for free: a once-a-day treatment reaches eight days
 * ahead, a four-slot treatment reaches two. It also bounds the total: a parent with
 * several treatments cannot flood the OS queue.
 */
export const TREATMENT_AHEAD = 8;

/** Hard bound on the times-of-day day walk. Only load-bearing for a treatment whose
 *  `timesOfDay` is empty, which accumulates no occurrences and would otherwise
 *  never reach TREATMENT_AHEAD. With at least one slot chosen the walk finishes
 *  inside nine days. */
export const TREATMENT_MAX_DAYS = 14;

function treatmentNote(treatment: Treatment, child: Child, fireAt: number): ScheduledNotification {
  const dosage = treatmentDosageLabel(treatment);
  return {
    // Keyed on the id, not the name: the id survives a rename and a rename must
    // not orphan pending alerts. The name still reaches the diff through the
    // title, and `diffScheduled` compares titles, so renaming a treatment
    // reschedules its alerts with the new copy.
    //
    // `fireAt` is in the identifier for the same reason it is in the pumping
    // one. Changing `everyHours`, or re-anchoring the grid, recomputes fireAt
    // for the same treatment; without it here the diff would see no change and
    // Android's already-pending alarm would stay at the old spacing (commit
    // bf7c0a5 was exactly this bug for pumping). It stays stable while `now`
    // advances, because fireAt derives from the anchor and the interval.
    identifier: `${REMINDER_PREFIX}treatment:${treatment.id}:${fireAt}`,
    kind: 'treatment',
    // The child leads, in the shape `staleReminders` already uses. Two siblings
    // on the same medicine would otherwise produce two alerts reading exactly
    // alike, and the identifier that tells them apart is not on screen. Named
    // unconditionally rather than only when the household has more than one
    // child in treatment: a title that changes with unrelated state would have
    // `diffScheduled` rewrite every pending alert the moment a second regimen
    // starts.
    title: `${child.first} · ${treatment.name.trim()} due`,
    // The dosage is the single most useful thing this can carry: it puts "5 mg"
    // on the lock screen without the parent opening the app. With no dosage
    // recorded there is nothing to say, so fall back to the instruction.
    body: dosage || 'Tap to log the dose.',
    fireAt,
    // Lands on the existing medication deep link with the treatment named, which
    // seeds the confirm sheet from it. See src/lib/logDeepLink.ts. The tap
    // opens, it never writes, so "tap to log the dose" stays literally true.
    // The child rides along too: this one opens a WRITE surface, so the route
    // refuses an unknown child rather than seeding the sheet against whoever
    // happens to be selected when the alert is tapped.
    data: { url: withChildParam(`/log/medication?treatment=${encodeURIComponent(treatment.id)}`, treatment.childId) },
  };
}

/**
 * Fixed times of day: each chosen slot fires at its mapped wall-clock hour.
 *
 * Walks forward day by day, stopping at TREATMENT_AHEAD occurrences, TREATMENT_MAX_DAYS
 * days, or the treatment's toDate, whichever comes first. Each instant is built off
 * THAT day's own midnight with setHours (via `timeOfDaySlotMs`), never as
 * midnight plus n * 86_400_000, so a DST boundary cannot move the 08:00 dose to
 * 07:00 or 09:00 for half the year.
 */
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
    // toDate is stored at local midnight and is inclusive, so the regimen covers
    // the whole of that day.
    if (treatment.toDate != null && dayMidnight > treatment.toDate) break;
    for (let k = 0; k < slots.length && out.length < TREATMENT_AHEAD; k++) {
      // TODAY ONLY: the kth slot (1-based, counted from the start of the day
      // rather than from now) is settled once k doses are logged today. This is
      // `treatmentDueState`'s counting rule expressed forward. Counting rather than
      // matching slot to dose is what makes a late dose behave: on a
      // morning+evening treatment one dose given at 19:00 settles the earlier owed
      // slot and leaves the later one owed, where a per-slot "any dose after
      // this slot clears it" rule would let that single dose clear both.
      // Future days are unaffected: their doses-today is zero by definition.
      if (day === 0 && dosesToday >= k + 1) continue;
      const fireAt = timeOfDaySlotMs(dayMidnight, slots[k]);
      if (fireAt <= now) continue;
      out.push(treatmentNote(treatment, child, fireAt));
    }
  }
  return out;
}

/**
 * Every N hours: a grid of occurrences anchored to the last logged dose,
 * structurally identical to `pumpReminders`.
 *
 * The grid re-anchors on every logged dose, because logging writes the store and
 * the write triggers a reconcile, so the normal way to correct a drifting
 * reminder is simply to log the dose, including after the fact with its real
 * time. `treatmentRemindersEnabledAt` covers the one gap that leaves: a dose
 * given but never logged. See setReminderPref in useAppStore.ts.
 */
function treatmentEveryHoursReminders(
  treatment: Treatment,
  child: Child,
  input: ScheduleInput,
  now: number,
): ScheduledNotification[] {
  // An interval with no hours set has no schedule to be late against.
  if (treatment.everyHours == null || treatment.everyHours <= 0) return [];

  const lastDoseAt = input.treatmentDoses[treatment.id]?.lastAt ?? null;
  // THE ORDER OF THE NEXT TWO STATEMENTS IS LOAD-BEARING. The null check must
  // come first. A plain Math.max(lastDoseAt ?? 0, enabledAt ?? 0), which is what
  // pumpReminders does, would manufacture a grid for a treatment that has never been
  // dosed. "Every 8 hours" means eight hours after the last dose; with no last
  // dose there is no defined next instant, and any anchor invented for one is a
  // guess the parent never made. The resync stamp may only ever MOVE an existing
  // grid forward, never bring one into being.
  //
  // The parent is not left unaware: treatmentDueState returns due: 1 for exactly this
  // case, so the Medication tile still reads "Amoxicilline due" in the app. They
  // simply get no push for a time the app made up. Logging dose one starts the
  // grid.
  if (lastDoseAt == null) return [];
  const anchor = Math.max(lastDoseAt, input.prefs.treatmentRemindersEnabledAt ?? 0);

  const interval = treatment.everyHours * 3_600_000;
  // toDate is stored at local midnight and is inclusive, so the regimen runs to
  // the end of that day. addDays keeps this correct across a DST boundary.
  const endsAt = treatment.toDate != null ? addDays(treatment.toDate, 1) : null;
  // Deriving the first occurrence from `now` rather than blindly from the anchor
  // is what makes the grid self-healing: if every scheduled occurrence has
  // already passed (the app sat closed for a day), it re-enters the grid on
  // phase instead of scheduling nothing.
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

/**
 * Reminders for the treatments a parent authored. Unlike the other five kinds,
 * which are derived from facts the app works out for itself, this one only ever
 * reports back a schedule the user typed in. That is why it ships on.
 */
function treatmentReminders(input: ScheduleInput, now: number): ScheduledNotification[] {
  const todayMidnight = startOfDay(now);
  const out: ScheduledNotification[] = [];
  for (const treatment of input.treatments) {
    // The treatment's OWN child. Scoped to the selected child until 0.15.2,
    // which was forced before 0.15.0 (a server load held one child, so a
    // sibling's dose history read as empty) and merely narrow afterwards.
    const child = input.children.find((c) => c.id === treatment.childId);
    // No child in the roster: an orphan record whose child is gone. `deleteChild`
    // purges treatments as of 0.15.2, so this is the stale-record case, and an
    // alert that can name nobody is worse than no alert.
    if (!child) continue;
    // Gate on `expected` the same way `dueReminders`, `ageReminders` and
    // `napReminders` do, but for a different reason: those three have no fact to
    // report yet while a child is due rather than born. A treatment cannot be
    // dosed against a due date either, AND `resolveLogDeepLink`
    // (src/lib/logDeepLink.ts) refuses to open anything for an expected child,
    // so without this guard the alert would fire and its own tap target would
    // refuse to service it. Per treatment, so one expecting child cannot
    // silence a born sibling's regimen.
    if (child.expected) continue;
    // Covers the paused flag and the fromDate/toDate range too.
    if (!isTreatmentActiveToday(treatment, todayMidnight, treatment.childId)) continue;
    // A treatment always carries a name (the editor requires one), but gate on it the
    // same way `logMedicationFromTreatment` does: an alert titled " due" whose tap
    // that action then refuses would be a dead tap.
    if (!treatment.name.trim()) continue;
    out.push(
      ...(treatment.scheduleMode === 'everyHours'
        ? treatmentEveryHoursReminders(treatment, child, input, now)
        : treatmentTimesOfDayReminders(treatment, child, input, now, todayMidnight)),
    );
  }
  return out;
}

/**
 * Catch-up nudges for milestones whose typical window closes without the parent
 * having logged them. The scheduled twin of the home-screen `MilestoneNudge`
 * card: both ask the same question about the same milestones, so both derive
 * "due" from `catchUpDueAt`, and answering the card retires the notification
 * through `answeredMilestoneKeysByChild`.
 *
 * Shares `AGE_HORIZON_MONTHS`, since these are absolute calendar instants off
 * the birth date exactly like the age reminders.
 */
function milestoneReminders(
  child: Child,
  input: ScheduleInput,
  now: number,
): ScheduledNotification[] {
  // `birth` holds a DUE date while expecting, so there is no age to measure a
  // typical window against. Same gate, and same reason, as `ageReminders`.
  if (child.expected) return [];

  const horizon = addMonths(now, AGE_HORIZON_MONTHS);
  const done = new Set([
    ...(input.reachedMilestoneKeysByChild[child.id] ?? []),
    ...(input.answeredMilestoneKeysByChild[child.id] ?? []),
  ]);

  // Several windows close at the same age (`lifts-head` and `first-smile` both
  // at 3 months), so group by instant: one alert per catalog entry would land
  // as a burst of near-identical notifications on the same morning.
  const byFireAt = new Map<number, MilestoneDef[]>();
  for (const m of MILESTONES) {
    if (done.has(m.key)) continue;
    const due = catchUpDueAt(child.birth, m);
    // `atReminderHour` moves BACK to 09:00 of the containing day, which can land
    // before `due` itself. Nudging on the following morning keeps the promise
    // that the notification never precedes the card.
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
      // The keys ride in the identifier so that logging one milestone out of a
      // batch yields a DIFFERENT id, which `diffScheduled` cancels and replaces
      // rather than leaving a pending alert that names it.
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
    // Every child, each against their own two key lists. This was the selected
    // child alone until 0.15.2, when `reachedMilestoneKeys` could only describe
    // one of them; looping then would have read every sibling as having reached
    // nothing and nudged their parent about milestones logged months ago.
    for (const c of input.children) out.push(...milestoneReminders(c, input, now));
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

interface ParsedReminderId {
  kind: string;
  /** everything between the kind and the trailing fire time */
  head: string;
  fireAt: number;
}

/**
 * Split `budkin:{kind}:{head}:{fireAt}` back apart, or null for anything that is
 * not one of ours.
 *
 * Every identifier this file builds ends in its fire time, so the trailing field
 * is read off the END rather than by position. `head` may itself contain colons
 * (the pump grid's `{anchor}:{n}`, the age step's slug, the milestone batch's
 * key list), so no fixed field count would hold across all seven kinds.
 */
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

/**
 * Whether the dose one already-delivered treatment alert was asking for has been
 * given.
 *
 * Reuses the two rules `treatmentDueState` already owns rather than inventing a
 * third. Dose-to-treatment attribution is by trimmed, case-insensitive NAME and
 * lives in `treatmentDoseScalars` (src/store/selectors.ts), because a
 * `MedicationEntry` carries no treatment reference that survives sync; this
 * layer only ever sees the derived scalars.
 *
 * Answers "not given" whenever it cannot answer confidently. A missing scalar
 * entry means the treatment was never CONSIDERED, not that no dose was logged:
 * `treatmentDoseScalars` gives every treatment it was handed a key, and
 * `scheduleSync` now hands it every child's treatments, grouped so that one
 * child's dose cannot settle a sibling's identically named regimen. A key can
 * therefore only be missing for a treatment that left the store mid-flight, and
 * answering "given" on that would tell a parent a dose had been given when the
 * app had simply never looked.
 */
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
    // `treatmentDueState`'s interval branch restated over the derived scalars:
    // the treatment is owed until a dose lands, and settled for one interval
    // after it. Logging the dose re-anchors the grid, which is the same event
    // that retires the banner, so the two stay in step by construction.
    if (treatment.everyHours == null || treatment.everyHours <= 0) return false;
    return doses.lastAt != null && now < doses.lastAt + treatment.everyHours * 3_600_000;
  }

  const todayMidnight = startOfDay(now);
  // A banner from an earlier day. `today` counts today's doses, which say
  // nothing about a slot on a day that has already ended, and the counting rule
  // below is explicitly today-only (see `treatmentTimesOfDayReminders`). Left in
  // the tray rather than guessed at.
  if (fireAt < todayMidnight) return false;
  const slots = TIME_OF_DAY_ORDER.filter((tod) => treatment.timesOfDay?.includes(tod));
  const k = slots.findIndex((tod) => timeOfDaySlotMs(todayMidnight, tod) === fireAt);
  // A slot the parent has since removed from the regimen. It has no index left
  // to count against, so nothing can settle it.
  if (k < 0) return false;
  // The kth slot today (0-based) is settled once k + 1 doses are logged today,
  // which is `treatmentTimesOfDayReminders`' forward suppression applied
  // backwards to a slot that has already fired. Counting rather than matching
  // slot to dose is what makes a late dose behave: on a morning+evening
  // treatment one dose given at 19:00 settles the earlier owed slot and leaves
  // the later one owed.
  return doses.today >= k + 1;
}

function isStaleDelivered(parsed: ParsedReminderId, input: ScheduleInput, now: number): boolean {
  switch (parsed.kind) {
    case 'nap':
      // Asked about the identifier's OWN child, never `selectedChildId`, so one
      // sibling falling asleep cannot sweep away the other's nudge. Otherwise
      // exactly the condition `napReminders` uses to refuse to schedule at all,
      // including the ongoing-sleep-entry case that carries no timer.
      return (
        runningTimer(input.timers, 'sleep', parsed.head) != null ||
        input.asleepChildIds[parsed.head] === true
      );
    case 'stale':
      // The alert asks "still going?" about one timer. Stopping or discarding it
      // takes it out of `timers`, and the question has answered itself.
      return !input.timers.some((t) => t.id === parsed.head);
    case 'pump':
      // Either a session is running right now, or one was logged at or after the
      // instant this occurrence was asking for. `lastPumpAt` is the same scalar
      // the grid is anchored on, so the two halves cannot disagree.
      return (
        pumpingTimerRunning(input.timers) ||
        (input.lastPumpAt != null && input.lastPumpAt >= parsed.fireAt)
      );
    case 'treatment':
      return treatmentDoseGiven(input, parsed.head, parsed.fireAt, now);
    default:
      // `due`, `age` and `milestone` each report a calendar fact that stays true
      // after it fires, so no condition retires them. Anything a later version
      // adds lands here too, and staying is the safe default.
      return false;
  }
}

/**
 * Which DELIVERED notifications have gone stale and should be swept out of the
 * tray.
 *
 * The counterpart to `diffScheduled`, and deliberately not built the same way.
 * `cancelScheduledNotificationAsync` only ever reaches PENDING alerts, and a
 * notification leaves the pending set the moment it fires, so a banner already
 * sitting in the shade is invisible to that diff. This is the pass that reaches
 * it: the nudge fires at 15:00, the parent starts the nap at 15:02, and without
 * this the suggestion sits there contradicting the app.
 *
 * CONDITION-DRIVEN, NOT DESIRED-SET-DRIVEN, and that distinction is the whole
 * design. Every builder above drops an occurrence once `fireAt <= now`, so a
 * reminder that has just legitimately fired is BY DEFINITION absent from the
 * desired set. "Dismiss anything no longer desired" would therefore clear every
 * banner the instant it arrived and the parent would never see one. So each kind
 * is asked its own specific question instead: has the thing this alert was
 * asking for actually happened?
 *
 * Pure, and `now`-parametrised like everything else here, so the native
 * reconciler in `applySchedule.android.ts` only has to supply the tray's
 * identifiers.
 */
export function staleDelivered(
  input: ScheduleInput,
  presentedIds: readonly string[],
  now: number,
): string[] {
  const out: string[] = [];
  for (const id of presentedIds) {
    // The same ownership contract `diffScheduled` enforces. A bare-uuid timer
    // notification belongs to `postNotification.android.ts` and is not ours to
    // dismiss.
    if (!id.startsWith(REMINDER_PREFIX)) continue;
    const parsed = parseReminderId(id);
    if (parsed && isStaleDelivered(parsed, input, now)) out.push(id);
  }
  return out;
}
