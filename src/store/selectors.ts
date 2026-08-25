/** Pure derived computations for the time-entry model and dashboard status. The scoping
 *  helpers return fresh arrays, so call them in a render body over a raw-selected array,
 *  NEVER inside a `useAppStore` selector: that loops zustand v5 forever on web. */

import type { Connection } from '@/data/repository';
import { parseClockInput } from '@/lib/timeParse';
import { normalizeWash, type WashKind } from '@/lib/wash';
import type { ActivityType, BathRhythm, Treatment, TreatmentTimeOfDay, Entry, LastFeed, Measurement, Timer } from '@/types/models';
import type { TimeEntryState, TimeField } from '@/types/timeEntry';

const M = 60000;

/** Unsynced CHILDREN are intentionally excluded. */
export function selectPendingCount(s: { queueCount: number; measurements: Measurement[] }): number {
  return s.queueCount + s.measurements.filter((m) => m.serverId == null).length;
}

/** Read straight through `useAppStore`, so it must keep returning a BOOLEAN. */
export function selectServerMode(s: { connection: Connection | null }): boolean {
  return s.connection?.mode === 'server';
}

/** `entries` is one flat, globally-scoped array of every child's records, so scope it or
 *  switching child shows the previous child's history. No `childId` yields `[]`. */
export function entriesForChild(entries: Entry[], childId: string | undefined): Entry[] {
  if (!childId) return [];
  return entries.filter((e) => e.childId === childId);
}

/** A timer belongs to whoever started it and to nobody else. It deliberately does NOT
 *  adopt an unowned one: every path stamps an owner, `hydrate` stamps the old ones. */
function timerBelongsTo(t: Timer, childId: string): boolean {
  return t.childId === childId;
}

/** NOT the rule the Timers tab uses: that one lists every child's timers so a sibling's
 *  stays stoppable. */
export function timersForChild(timers: Timer[], childId: string | undefined): Timer[] {
  if (!childId) return [];
  return timers.filter((t) => timerBelongsTo(t, childId));
}

/** Keyed on `saveAs`, NEVER on `activity`: `setTimerSaveAs` leaves `activity` at whatever
 *  the timer was started as, so an `activity`-keyed lookup cannot see a quick timer
 *  repointed to sleep. `saveAs` is what the timer will be written as. */
export function runningTimer(timers: Timer[], saveAs: ActivityType, childId: string | undefined): Timer | undefined {
  if (!childId) return undefined;
  return timers.find((t) => t.saveAs === saveAs && timerBelongsTo(t, childId));
}

export function measurementsForChild(measurements: Measurement[], childId: string | undefined): Measurement[] {
  if (!childId) return [];
  return measurements.filter((m) => m.childId === childId);
}

const DEFAULT_ORDER: TimeField[] = ['end', 'lasted', 'start'];

/** `order` lists the three interval quantities most-recently-touched first, so the
 *  first two are the active (pinned) ones and order[2] is the derived one. */
export function derivedField(order: TimeField[] | undefined): TimeField {
  return order && order.length === 3 ? order[2] : 'start';
}

export function isActive(order: TimeField[] | undefined, f: TimeField): boolean {
  return (order && order.length === 3 ? order : DEFAULT_ORDER).indexOf(f) < 2;
}

export function reorder(order: TimeField[] | undefined, f: TimeField): TimeField[] {
  const base = order && order.length === 3 ? order : DEFAULT_ORDER;
  return [f, ...base.filter((x) => x !== f)];
}

/** A nudge to an endpoint OVERRULES an active "lasted": the OTHER endpoint is frozen at
 *  its resolved ms (so a `now`-relative one stops drifting) and `lasted` is demoted to
 *  derived. `null` means it does not apply: `ongoing`, or `lasted` already derived. */
export function overruleLasted(
  te: TimeEntryState,
  now: number,
  nudged: 'start' | 'end',
): { frozen: number; order: TimeField[] } | null {
  if (te.ongoing || !isActive(te.order, 'lasted')) return null;
  if (nudged === 'start') return { frozen: teEnd(te, now), order: ['start', 'end', 'lasted'] };
  return { frozen: teStart(te, now) ?? now, order: ['end', 'start', 'lasted'] };
}

function endPinned(te: TimeEntryState, now: number): number {
  return te.endAbs ?? now - (te.endAgoMin ?? 0) * M;
}
function startPinned(te: TimeEntryState, now: number): number {
  return te.startAbs ?? now - (te.startAgoMin ?? 0) * M;
}

/** Resulting end timestamp (ms); for ongoing entries this is `now` (live). */
export function teEnd(te: TimeEntryState, now: number): number {
  if (te.shape === 'point') return te.absTime ?? now - (te.agoMin ?? 0) * M;
  if (te.ongoing) return now;
  if (derivedField(te.order) === 'end') return startPinned(te, now) + (te.durationMin ?? 0) * M;
  return endPinned(te, now);
}

/** Resulting start timestamp (ms), or null for the point shape. */
export function teStart(te: TimeEntryState, now: number): number | null {
  if (te.shape === 'point') return null;
  if (derivedField(te.order) === 'start') return teEnd(te, now) - (te.durationMin ?? 0) * M;
  return startPinned(te, now);
}

export function teDurationMin(te: TimeEntryState, now: number): number {
  if (te.shape === 'point') return 0;
  const s = teStart(te, now) ?? now;
  return Math.max(0, Math.round((teEnd(te, now) - s) / M));
}

/** Suggested breast to start the next feed on: the opposite of last time. */
export function nextStartSide(entries: Entry[]): 'left' | 'right' {
  const last = entries
    .filter((e): e is Extract<Entry, { type: 'feeding' }> => e.type === 'feeding')
    .sort((a, b) => b.start - a.start)[0];
  if (!last) return 'left';
  const side =
    last.method === 'left'
      ? 'left'
      : last.method === 'right'
        ? 'right'
        : last.tags.includes('left')
          ? 'left'
          : last.tags.includes('right')
            ? 'right'
            : null;
  return side === 'left' ? 'right' : side === 'right' ? 'left' : 'left';
}

/** `openSheet` alternates the side from this, so a fresh sheet suggests the right. */
export const LAST_FEED_DEFAULT: LastFeed = { feedType: 'breast', method: 'left' };

/** `fallback` carries the account-wide value from before this map was keyed per child,
 *  read rather than seeded at hydration, so it performs no write and needs no ordering.
 *  No child yields the fallback, never somebody else's draft: the sheet SAVES this. */
export function lastFeedForChild(
  map: Record<string, LastFeed>,
  childId: string | undefined,
  fallback: LastFeed,
): LastFeed {
  return (childId ? map[childId] : undefined) ?? fallback;
}

export function lastFeedEndMinAgo(entries: Entry[], now: number): number | null {
  const f = entries
    .filter((e): e is Extract<Entry, { type: 'feeding' }> => e.type === 'feeding' && e.end != null)
    .sort((a, b) => (b.end as number) - (a.end as number))[0];
  return f ? Math.round((now - (f.end as number)) / M) : null;
}

export function lastFeedStartMinAgo(entries: Entry[], now: number): number | null {
  const f = entries
    .filter((e): e is Extract<Entry, { type: 'feeding' }> => e.type === 'feeding' && e.end != null)
    .sort((a, b) => b.start - a.start)[0];
  return f ? Math.round((now - f.start) / M) : null;
}

export function lastWakeMinAgo(entries: Entry[], now: number): number | null {
  const s = entries
    .filter((e): e is Extract<Entry, { type: 'sleep' }> => e.type === 'sleep' && e.end != null)
    .sort((a, b) => (b.end as number) - (a.end as number))[0];
  return s ? Math.round((now - (s.end as number)) / M) : null;
}

export function lastSleepStartMinAgo(entries: Entry[], now: number): number | null {
  const s = entries
    .filter((e): e is Extract<Entry, { type: 'sleep' }> => e.type === 'sleep' && e.end != null)
    .sort((a, b) => b.start - a.start)[0];
  return s ? Math.round((now - s.start) / M) : null;
}

const DAY = 24 * 60 * M;

/** Three days matches the mainstream 2-to-3-full-baths-a-week guidance for an infant. */
export const BATH_RHYTHM_DEFAULT: BathRhythm = { fullEveryDays: 3, quickEveryDays: 1 };

/** Days. 0 is not degenerate here, it is the OFF switch: that kind of wash never comes
 *  due, so do not restore a minimum of 1. 30 is a soft cap low enough that a typo like
 *  500 is caught rather than quietly meaning "never". */
export const BATH_INTERVAL_MIN = 0;
export const BATH_INTERVAL_MAX = 30;

/** A non-finite value returns `fallback` rather than 0: silently switching a reminder
 *  off is worse than keeping the previous cadence. */
export function clampBathInterval(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(BATH_INTERVAL_MAX, Math.max(BATH_INTERVAL_MIN, Math.round(n)));
}

export function clampBathRhythm(r: Partial<BathRhythm> | undefined, fallback: BathRhythm): BathRhythm {
  return {
    fullEveryDays: clampBathInterval(r?.fullEveryDays ?? fallback.fullEveryDays, fallback.fullEveryDays),
    quickEveryDays: clampBathInterval(r?.quickEveryDays ?? fallback.quickEveryDays, fallback.quickEveryDays),
  };
}

/** The rhythm implied by the legacy global pref. `smallWashesPerBig: 3` meant a full bath
 *  on the 4th bath of the cycle, which on daily bathing is every 4 days, hence the `+ 1`.
 *  Derived on read, so no write and no ordering dependency at hydration. */
export function legacyBathRhythm(smallWashesPerBig: number | undefined): BathRhythm {
  if (smallWashesPerBig == null || !Number.isFinite(smallWashesPerBig)) return BATH_RHYTHM_DEFAULT;
  return {
    fullEveryDays: clampBathInterval(Math.round(smallWashesPerBig) + 1, BATH_RHYTHM_DEFAULT.fullEveryDays),
    quickEveryDays: 1,
  };
}

export function rhythmForChild(
  map: Record<string, BathRhythm>,
  childId: string | null,
  fallback: BathRhythm,
): BathRhythm {
  const stored = childId ? map[childId] : undefined;
  return stored ? clampBathRhythm(stored, fallback) : fallback;
}

/** The next wash to come due, once neither is due yet. */
export interface WashUpcoming {
  kind: WashKind;
  inDays: number;
}

export interface WashDue {
  full: boolean;
  quick: boolean;
  /** what to pre-select in the log sheet; `full` wins when both are due */
  nextKind: WashKind;
  /** the sooner upcoming wash, or null while one is already due or both are off */
  upcoming: WashUpcoming | null;
}

/** The load-bearing asymmetry: ANY bath resets the quick-wash clock, but only a FULL bath
 *  resets the full-bath clock. That is what lets the same two numbers describe a newborn
 *  (full off, quick 1) and a toddler (full 1, quick 1). Distance is in local CALENDAR
 *  days: `Math.round` over `startOfDay` absorbs DST's 23 and 25-hour days. */
export function washDueState(entries: Entry[], rhythm: BathRhythm, now: number): WashDue {
  const baths = entries
    .filter((e): e is Extract<Entry, { type: 'bath' }> => e.type === 'bath')
    .sort((a, b) => b.time - a.time);
  const today = startOfDay(now);
  const daysSince = (e: { time: number } | undefined): number | null =>
    e ? Math.round((today - startOfDay(e.time)) / DAY) : null;

  const fullEvery = clampBathInterval(rhythm.fullEveryDays, BATH_RHYTHM_DEFAULT.fullEveryDays);
  const quickEvery = clampBathInterval(rhythm.quickEveryDays, BATH_RHYTHM_DEFAULT.quickEveryDays);

  // normalizeWash rather than a raw `b.wash === 'full'` compare: a bath sitting in the
  // offline queue or pending-ops log from before the rename carries the literal legacy
  // `'big'`, and neither store runs it through entityStore.ts's load-time normalization.
  const sinceFull = daysSince(baths.find((b) => normalizeWash(b.wash) === 'full'));
  const sinceAny = daysSince(baths[0]);

  const full = fullEvery > 0 && (sinceFull === null || sinceFull >= fullEvery);
  const quick = quickEvery > 0 && (sinceAny === null || sinceAny >= quickEvery);

  let upcoming: WashUpcoming | null = null;
  if (!full && !quick) {
    const untilFull = fullEvery > 0 && sinceFull !== null ? fullEvery - sinceFull : null;
    const untilQuick = quickEvery > 0 && sinceAny !== null ? quickEvery - sinceAny : null;
    // Ties go to the full bath: it is the more significant of the two.
    if (untilFull !== null && (untilQuick === null || untilFull <= untilQuick)) {
      upcoming = { kind: 'full', inDays: untilFull };
    } else if (untilQuick !== null) {
      upcoming = { kind: 'quick', inDays: untilQuick };
    }
  }

  return { full, quick, nextKind: full ? 'full' : 'quick', upcoming };
}

/** "Today" is the wall-clock day of `now`, so this flips back to false on its own at
 *  local midnight as the dashboard's `now` ticks over: no stored flag, no reset logic. */
export function bathGivenToday(entries: Entry[], now: number): boolean {
  const today = new Date(now).toDateString();
  return entries.some((e) => e.type === 'bath' && new Date(e.time).toDateString() === today);
}

/** The window, in minutes since local midnight, in which a sleep counts as a NAP: one
 *  that STARTS inside it. Start inclusive, end exclusive. Minutes rather than a Date
 *  because this is a wall-clock rule that has to mean the same thing on every date,
 *  across DST shifts, and inside the headless widget task that has no store to read. */
export interface NapWindow {
  startMin: number;
  endMin: number;
}

/** 07:00 to 19:00. */
export const NAP_WINDOW_START_DEFAULT = 420;
export const NAP_WINDOW_END_DEFAULT = 1140;
export const DEFAULT_NAP_WINDOW: NapWindow = {
  startMin: NAP_WINDOW_START_DEFAULT,
  endMin: NAP_WINDOW_END_DEFAULT,
};

export const MINUTES_PER_DAY = 1440;

/** Into 0..1439. `fallback` covers non-finite input only; a finite out-of-range number is
 *  clamped, since that still expresses an intent worth honouring. */
export function clampMinuteOfDay(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MINUTES_PER_DAY - 1, Math.max(0, Math.round(n)));
}

/** The Insights "Rhythm" graph's default day boundary: noon (noon-to-noon). */
export const RHYTHM_ORIGIN_DEFAULT = 12;

export function clampHourOfDay(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(23, Math.max(0, Math.round(n)));
}
export function fmtDayStartHour(h: number): string {
  const hr = clampHourOfDay(h, RHYTHM_ORIGIN_DEFAULT);
  if (hr === 0) return 'midnight';
  if (hr === 12) return 'noon';
  return `${hr}:00`;
}

/** A minute-of-day as a zero-padded 24-hour clock, e.g. 420 to "07:00". */
export function fmtMinuteOfDay(min: number): string {
  const m = clampMinuteOfDay(min, 0);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Shares `parseClockInput` with the log sheet's time editor, so the digits-first
 *  shorthand works in both ("7" to 07:00). Null when the text isn't a time, so a caller
 *  can keep the stored value rather than write a garbage boundary. */
export function parseMinuteOfDay(text: string): number | null {
  const parsed = parseClockInput(text);
  return parsed ? parsed.h * 60 + parsed.m : null;
}

/** A window with start AFTER end WRAPS midnight (20:00 to 04:00, for a household whose
 *  long sleep is in the daytime); without that case an inverted setting would match
 *  nothing and every sleep would silently become night sleep. start === end is an EMPTY
 *  window, not a full day, which is the useful reading for a child who no longer naps. */
export function minuteOfDayIsNap(min: number, w: NapWindow = DEFAULT_NAP_WINDOW): boolean {
  const s = clampMinuteOfDay(w.startMin, NAP_WINDOW_START_DEFAULT);
  const e = clampMinuteOfDay(w.endMin, NAP_WINDOW_END_DEFAULT);
  if (s === e) return false;
  return s < e ? min >= s && min < e : min >= s || min < e;
}

/** Keyed on the start, not the wake: Baby Buddy classifies on start only, so anything
 *  else flips its answer the moment the record round-trips through the server. */
export function isNapStart(startMs: number, w: NapWindow = DEFAULT_NAP_WINDOW): boolean {
  const d = new Date(startMs);
  return minuteOfDayIsNap(d.getHours() * 60 + d.getMinutes(), w);
}

export function lastDiaper(entries: Entry[]) {
  return entries
    .filter((e): e is Extract<Entry, { type: 'diaper' }> => e.type === 'diaper')
    .sort((a, b) => b.time - a.time)[0];
}

export function lastDiaperMinAgo(entries: Entry[], now: number): number | null {
  const d = lastDiaper(entries);
  return d ? Math.round((now - d.time) / M) : null;
}

export function endAnchorVisible(tMs: number, startMs: number, now: number): boolean {
  return tMs > startMs && tMs <= now;
}

/** Treatment dates are stored at local midnight, so "active today" is a plain numeric
 *  comparison. setHours rather than ms arithmetic, so it stays put across DST. */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Both date boundaries are inclusive, so a treatment whose fromDate or toDate is
 *  exactly `todayMidnight` still counts. */
export function isTreatmentActiveToday(treatment: Treatment, todayMidnight: number, childId: string): boolean {
  return (
    treatment.active &&
    treatment.childId === childId &&
    treatment.fromDate <= todayMidnight &&
    (treatment.toDate == null || treatment.toDate >= todayMidnight)
  );
}

export function activeTreatmentsForChildToday(treatments: Treatment[], childId: string, todayMidnight: number): Treatment[] {
  if (!childId) return [];
  return treatments.filter((c) => isTreatmentActiveToday(c, todayMidnight, childId));
}

/** Fixed rather than a setting: a wrong-by-an-hour slot costs nothing, since a dose stays
 *  due until it is given, it never lapses. */
export const TREATMENT_TIME_OF_DAY_HOUR: Record<TreatmentTimeOfDay, number> = {
  morning: 8,
  noon: 12,
  evening: 18,
  night: 22,
};

/** setHours off the day's midnight rather than adding hours, so the slot stays on the
 *  intended hour across a DST boundary. */
export function timeOfDaySlotMs(todayMidnight: number, tod: TreatmentTimeOfDay): number {
  const d = new Date(todayMidnight);
  d.setHours(TREATMENT_TIME_OF_DAY_HOUR[tod], 0, 0, 0);
  return d.getTime();
}

/** A dose is attributed to a treatment BY NAME (trimmed, case-insensitive): Baby Buddy
 *  has no field linking a medication entry back to a treatment, so a `treatmentId` would
 *  be dropped the moment the dose round-trips through the server. */
const normName = (s: string) => s.trim().toLowerCase();

function dosesForTreatment(entries: Entry[], treatment: Treatment): Extract<Entry, { type: 'medication' }>[] {
  const name = normName(treatment.name);
  return entries.filter(
    (e): e is Extract<Entry, { type: 'medication' }> => e.type === 'medication' && normName(e.name) === name,
  );
}

export interface TreatmentDue {
  treatment: Treatment;
  /** doses that are owed now: their moment has passed and none was logged for it */
  due: number;
  /** doses today's schedule called for at all, given or not */
  expected: number;
}

/** Times-of-day treatments COUNT rather than match slot-to-dose: `due` is the slots
 *  reached today minus the doses logged today, floored at zero. That is what makes a late
 *  dose behave: one dose at 19:00 on a morning+evening treatment settles one owed dose
 *  and leaves the other owed. Interval treatments owe at most ONE dose at once. */
export function treatmentDueState(treatment: Treatment, entries: Entry[], now: number): TreatmentDue {
  const doses = dosesForTreatment(entries, treatment);
  const todayMidnight = startOfDay(now);
  const dosesToday = doses.filter((e) => e.time >= todayMidnight && e.time <= now).length;

  if (treatment.scheduleMode === 'everyHours') {
    // An interval with no hours set has no schedule to be late against.
    if (treatment.everyHours == null) return { treatment, due: 0, expected: dosesToday };
    const last = doses.reduce<number | null>((max, e) => (e.time <= now && (max == null || e.time > max) ? e.time : max), null);
    const due = last == null || now >= last + treatment.everyHours * 3600000 ? 1 : 0;
    return { treatment, due, expected: dosesToday + due };
  }

  // As-needed: never owed, and `expected` stays 0 even once dosed today - there is no
  // schedule it was called for, so a sporadic dose must never turn "Nothing due" into
  // "All doses given". See `treatmentCooldownState` for the gate that instead blocks
  // logging too soon.
  if (treatment.scheduleMode === 'sporadic') return { treatment, due: 0, expected: 0 };

  const reached = (treatment.timesOfDay ?? []).filter((tod) => now >= timeOfDaySlotMs(todayMidnight, tod)).length;
  return { treatment, due: Math.max(0, reached - dosesToday), expected: reached };
}

export interface TreatmentCooldown {
  /** a dose was logged more recently than `everyHours` ago */
  inCooldown: boolean;
  /** epoch ms the cooldown lifts; `null` when never dosed or no cooldown is set */
  readyAt: number | null;
}

/** Sporadic-only gate: unlike `treatmentDueState`, this never makes a treatment "due" -
 *  it only flags a dose logged too soon after the last one, for a non-blocking warning
 *  at the moment of logging. */
export function treatmentCooldownState(treatment: Treatment, entries: Entry[], now: number): TreatmentCooldown {
  if (treatment.scheduleMode !== 'sporadic' || treatment.everyHours == null) return { inCooldown: false, readyAt: null };
  const last = dosesForTreatment(entries, treatment).reduce<number | null>(
    (max, e) => (e.time <= now && (max == null || e.time > max) ? e.time : max),
    null,
  );
  if (last == null) return { inCooldown: false, readyAt: null };
  const readyAt = last + treatment.everyHours * 3600000;
  return { inCooldown: now < readyAt, readyAt };
}

/** Lives here rather than in the notifications layer so dose-to-treatment name
 *  attribution has exactly one home, including the `e.time <= now` bound that keeps a
 *  dose stamped in the future from counting as given. Every treatment gets an entry. */
export function treatmentDoseScalars(
  treatments: Treatment[],
  entries: Entry[],
  now: number,
): Record<string, { today: number; lastAt: number | null }> {
  const todayMidnight = startOfDay(now);
  const out: Record<string, { today: number; lastAt: number | null }> = {};
  for (const treatment of treatments) {
    const doses = dosesForTreatment(entries, treatment);
    out[treatment.id] = {
      today: doses.filter((e) => e.time >= todayMidnight && e.time <= now).length,
      lastAt: doses.reduce<number | null>(
        (max, e) => (e.time <= now && (max == null || e.time > max) ? e.time : max),
        null,
      ),
    };
  }
  return out;
}

/** Due ones FIRST, stable within each group so an undue treatment never jumps around as
 *  `now` ticks. Fresh array: never call it inside a `useAppStore` selector. */
export function treatmentDueList(treatments: Treatment[], childId: string | undefined, entries: Entry[], now: number): TreatmentDue[] {
  if (!childId) return [];
  return activeTreatmentsForChildToday(treatments, childId, startOfDay(now))
    .map((c) => treatmentDueState(c, entries, now))
    .sort((a, b) => (a.due > 0 ? 0 : 1) - (b.due > 0 ? 0 : 1));
}

export function totalTreatmentDue(list: TreatmentDue[]): number {
  return list.reduce((sum, d) => sum + d.due, 0);
}

/** One owed dose names its treatment ("Omeprazol due"); more than one can't be named, so
 *  it counts instead. `null` means the tile keeps its default copy. */
export function treatmentDueHint(list: TreatmentDue[]): string | null {
  if (list.length === 0) return null;
  const due = totalTreatmentDue(list);
  if (due === 1) {
    const owed = list.find((d) => d.due > 0);
    return owed ? `${owed.treatment.name.trim()} due` : null;
  }
  if (due > 1) return `${due} doses due`;
  // Nothing owed: separate all-given from a first dose that simply isn't due yet.
  return list.some((d) => d.expected > 0) ? 'All doses given' : 'Nothing due';
}

/** Doses were called for today and every one is logged; no treatments means no check. */
export function treatmentsAllGiven(list: TreatmentDue[]): boolean {
  return list.length > 0 && totalTreatmentDue(list) === 0 && list.some((d) => d.expected > 0);
}
