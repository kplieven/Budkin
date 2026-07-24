/**
 * Pure derived computations for the time-entry model and dashboard status.
 * Kept separate from the store so they're trivially unit-testable.
 */

import { parseClockInput } from '@/lib/timeParse';
import type { Cure, Entry, Measurement, Timer } from '@/types/models';
import type { TimeEntryState, TimeField } from '@/types/timeEntry';

const M = 60000;

/**
 * Offline "pending sync" count shown in the offline banners: queued entries
 * (`queueCount`) plus measurements created offline that haven't synced yet
 * (`serverId == null`). Unsynced CHILDREN are intentionally excluded — their
 * omission is pre-existing design and out of scope here.
 *
 * Takes a structural subset so it doubles as a stable zustand selector:
 * `useAppStore(selectPendingCount)`. It returns a plain number, so the store's
 * default `Object.is` equality prevents needless re-renders.
 */
export function selectPendingCount(s: { queueCount: number; measurements: Measurement[] }): number {
  return s.queueCount + s.measurements.filter((m) => m.serverId == null).length;
}

/**
 * The entries owned by one child. `entries` is a single flat, globally-scoped
 * array holding every child's records, so every history surface must scope it
 * before rendering, otherwise switching child (or selecting an expecting one)
 * shows the previous child's history.
 *
 * An absent `childId` yields `[]`, not everything: with no child selected there
 * is no history to show, and a permissive fallback would resurrect the bug.
 * There is deliberately no fallback for an entry with a missing `childId`
 * either, for the same reason.
 *
 * Pure, so it must be called in the render body over a raw-selected array, not
 * inside a `useAppStore` selector: returning a fresh array from a selector makes
 * zustand v5 see a perpetually-changed snapshot and loop forever.
 */
export function entriesForChild(entries: Entry[], childId: string | undefined): Entry[] {
  if (!childId) return [];
  return entries.filter((e) => e.childId === childId);
}

/**
 * The running timers belonging on one child's history. Scoped like
 * `entriesForChild`, with one deliberate difference: a timer with NO `childId`
 * counts as the selected child's. `childId` is optional on `Timer` and the rest
 * of the app already reads an unowned timer as the current child's (the
 * dashboard's running-timer card does no scoping at all), so dropping it here
 * would hide a genuinely running timer.
 *
 * This is NOT the rule the Timers tab uses: that one deliberately lists every
 * child's timers, so a sibling's timer stays stoppable. History is per-child, so
 * a sibling's timer belongs in the sibling's history, not this one's.
 *
 * Pure, so it must be called in the render body over a raw-selected array, not
 * inside a `useAppStore` selector: returning a fresh array from a selector makes
 * zustand v5 see a perpetually-changed snapshot and loop forever.
 */
export function timersForChild(timers: Timer[], childId: string | undefined): Timer[] {
  if (!childId) return [];
  return timers.filter((t) => t.childId == null || t.childId === childId);
}

/** Measurements owned by one child. Same scoping rules as `entriesForChild`. */
export function measurementsForChild(measurements: Measurement[], childId: string | undefined): Measurement[] {
  if (!childId) return [];
  return measurements.filter((m) => m.childId === childId);
}

const DEFAULT_ORDER: TimeField[] = ['end', 'lasted', 'start'];

/** The derived (computed) interval quantity — order[2]. */
export function derivedField(order: TimeField[] | undefined): TimeField {
  return order && order.length === 3 ? order[2] : 'start';
}

/** Whether a quantity is one of the two active (pinned) ones. */
export function isActive(order: TimeField[] | undefined, f: TimeField): boolean {
  return (order && order.length === 3 ? order : DEFAULT_ORDER).indexOf(f) < 2;
}

/** Move `f` to most-recent; the resulting order[2] becomes the derived one. */
export function reorder(order: TimeField[] | undefined, f: TimeField): TimeField[] {
  const base = order && order.length === 3 ? order : DEFAULT_ORDER;
  return [f, ...base.filter((x) => x !== f)];
}

/**
 * A nudge to an endpoint OVERRULES an active "lasted" duration: only the nudged
 * endpoint should move, so the OTHER endpoint is frozen at its current resolved
 * ms and `lasted` is demoted to the derived quantity (`end − start`). Freezing
 * the resolved value matters so a `now`-relative opposite endpoint stops
 * drifting once the nudge pins it.
 *
 * Returns `{ frozen, order }` when the override applies, or `null` when it does
 * not — i.e. while `ongoing` (the end must stay live) or when `lasted` is
 * already derived (both endpoints pinned, so a normal reorder suffices).
 */
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

/** Derived duration in minutes (end − start), or live elapsed when ongoing. */
export function teDurationMin(te: TimeEntryState, now: number): number {
  if (te.shape === 'point') return 0;
  const s = teStart(te, now) ?? now;
  return Math.max(0, Math.round((teEnd(te, now) - s) / M));
}

/** Suggested breast to start the next feed on — the opposite of last time. */
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

/** Minutes since the most recent completed feeding ended, or null. */
export function lastFeedEndMinAgo(entries: Entry[], now: number): number | null {
  const f = entries
    .filter((e): e is Extract<Entry, { type: 'feeding' }> => e.type === 'feeding' && e.end != null)
    .sort((a, b) => (b.end as number) - (a.end as number))[0];
  return f ? Math.round((now - (f.end as number)) / M) : null;
}

/** Minutes since the most recent completed feeding *started*, or null. */
export function lastFeedStartMinAgo(entries: Entry[], now: number): number | null {
  const f = entries
    .filter((e): e is Extract<Entry, { type: 'feeding' }> => e.type === 'feeding' && e.end != null)
    .sort((a, b) => b.start - a.start)[0];
  return f ? Math.round((now - f.start) / M) : null;
}

/** Minutes since the most recent completed sleep ended (woke), or null. */
export function lastWakeMinAgo(entries: Entry[], now: number): number | null {
  const s = entries
    .filter((e): e is Extract<Entry, { type: 'sleep' }> => e.type === 'sleep' && e.end != null)
    .sort((a, b) => (b.end as number) - (a.end as number))[0];
  return s ? Math.round((now - (s.end as number)) / M) : null;
}

/** Minutes since the most recent completed sleep *started*, or null. */
export function lastSleepStartMinAgo(entries: Entry[], now: number): number | null {
  const s = entries
    .filter((e): e is Extract<Entry, { type: 'sleep' }> => e.type === 'sleep' && e.end != null)
    .sort((a, b) => b.start - a.start)[0];
  return s ? Math.round((now - s.start) / M) : null;
}

/**
 * The user's bath rhythm, counted in SMALL washes between two big ones. 3 means
 * three smalls then a big, i.e. a four-bath cycle. It counts smalls rather than
 * the whole cycle so the setting reads the way the UI phrases it ("big wash
 * after every 3 small washes"); reading it as a cycle length is off by one.
 *
 * 3 is the default because it reproduces the rhythm that used to be hardcoded.
 */
export const SMALL_WASHES_PER_BIG_DEFAULT = 3;
export const SMALL_WASHES_PER_BIG_MIN = 1;
/**
 * A soft cap, not a real limit on anyone's rhythm: 30 is far past any bath
 * routine a person actually keeps, while still low enough that a typo like 500
 * is caught rather than quietly meaning "a big wash never comes due". The
 * minimum stays 1 for the harder reason given on `clampSmallWashesPerBig`.
 */
export const SMALL_WASHES_PER_BIG_MAX = 30;

/**
 * Coerce a rhythm from anywhere (a persisted pref, a stale build's value) into
 * the supported range. 0 in particular must not survive: an empty lookback
 * window makes `every()` vacuously true, so a big wash would read as due
 * forever.
 */
export function clampSmallWashesPerBig(n: number): number {
  if (!Number.isFinite(n)) return SMALL_WASHES_PER_BIG_DEFAULT;
  return Math.min(SMALL_WASHES_PER_BIG_MAX, Math.max(SMALL_WASHES_PER_BIG_MIN, Math.round(n)));
}

/**
 * The wash due next, from the user's rhythm: a "small wash" most days, a "big
 * wash" every few days. Rule: if the last `smallWashesPerBig` washes are ALL
 * small, a big wash is due; otherwise small. Fewer washes on record than the
 * interval (or none at all) → small.
 *
 * The answer is derived from history on every call, never from a stored
 * counter, so changing the interval re-reads the existing baths immediately.
 * Raising it can therefore take a big wash back off the schedule, which is
 * correct by definition: the rule is about the last N washes, not about where
 * some earlier cycle happened to be anchored.
 */
export function nextWashKind(entries: Entry[], smallWashesPerBig: number = SMALL_WASHES_PER_BIG_DEFAULT): 'small' | 'big' {
  const n = clampSmallWashesPerBig(smallWashesPerBig);
  const recent = entries
    .filter((e): e is Extract<Entry, { type: 'bath' }> => e.type === 'bath')
    .sort((a, b) => b.time - a.time)
    .slice(0, n);
  return recent.length === n && recent.every((b) => b.wash === 'small') ? 'big' : 'small';
}

/**
 * Whether at least one wash (bath) is on record for today's local date,
 * relative to `now`. "Today" is the wall-clock day of `now`, so the answer
 * flips back to false on its own at local midnight as the dashboard's
 * per-second `now` tick crosses over: no stored flag, no reset logic.
 *
 * Multiple washes a day are allowed by the model, so this only asks whether
 * there is one or more, never how many. Pure and `now`-parametrised, so scope
 * the entries to the child first (`entriesForChild`) before calling, exactly
 * like the other status helpers.
 */
export function bathGivenToday(entries: Entry[], now: number): boolean {
  const today = new Date(now).toDateString();
  return entries.some((e) => e.type === 'bath' && new Date(e.time).toDateString() === today);
}

/**
 * The window, in minutes since local midnight, in which a sleep counts as a NAP.
 * A sleep that STARTS inside it is a nap; one that starts outside it is night
 * sleep. Start is inclusive, end is exclusive.
 *
 * Minutes rather than a Date because this is a wall-clock rule, not an instant:
 * "naps run 07:00 to 19:00" has to mean the same thing on every date, across DST
 * shifts, and inside the headless widget task that has no store to read.
 */
export interface NapWindow {
  startMin: number;
  endMin: number;
}

/** 07:00 to 19:00, reproducing the rule that used to be hardcoded in three places. */
export const NAP_WINDOW_START_DEFAULT = 420;
export const NAP_WINDOW_END_DEFAULT = 1140;
export const DEFAULT_NAP_WINDOW: NapWindow = {
  startMin: NAP_WINDOW_START_DEFAULT,
  endMin: NAP_WINDOW_END_DEFAULT,
};

export const MINUTES_PER_DAY = 1440;

/**
 * Coerce a minute-of-day from anywhere (a persisted pref, a stale build) into
 * 0..1439. `fallback` covers non-finite input only; an out-of-range but finite
 * number is clamped, since that still expresses an intent (a very early or very
 * late boundary) worth honouring.
 */
export function clampMinuteOfDay(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MINUTES_PER_DAY - 1, Math.max(0, Math.round(n)));
}

/** The Insights "Rhythm" graph's default day boundary: noon (noon-to-noon). */
export const RHYTHM_ORIGIN_DEFAULT = 12;

/** Coerce a persisted rhythm-origin hour into a whole 0..23. */
export function clampHourOfDay(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(23, Math.max(0, Math.round(n)));
}

/**
 * Human label for a day-boundary hour (0..23) in 24-hour style, matching the
 * "Day starts at" setting: 0 -> "midnight", 12 -> "noon", else "H:00" (no
 * leading zero, e.g. 7 -> "7:00", 19 -> "19:00").
 */
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

/**
 * The inverse of `fmtMinuteOfDay`: typed clock text to a minute-of-day.
 *
 * Shares `parseClockInput` with the log sheet's time editor, so the same
 * digits-first shorthand works in both places ("7" to 07:00, "730" to 07:30,
 * "19:30" to 19:30) and 24-hour is enforced in exactly one place. Returns null
 * when the text isn't a time, so a caller can discard the edit and keep the
 * stored value rather than writing a garbage boundary.
 */
export function parseMinuteOfDay(text: string): number | null {
  const parsed = parseClockInput(text);
  return parsed ? parsed.h * 60 + parsed.m : null;
}

/**
 * Whether a minute-of-day falls inside the nap window. Start inclusive, end
 * exclusive, so the default 420/1140 reproduces the old `hr >= 7 && hr < 19`
 * exactly.
 *
 * A window with start AFTER end WRAPS midnight (e.g. 20:00 to 04:00, for a
 * household whose long sleep is in the daytime). Without that case an inverted
 * setting would match nothing at all and every sleep would silently become
 * night sleep, which reads as a bug rather than as a setting.
 *
 * start === end is an EMPTY window, not a full day: [s, s) is empty under an
 * inclusive start and exclusive end, and the empty reading is the useful one
 * (an older child who no longer naps, so every sleep is night sleep). A
 * full-day reading is still reachable as 00:00 to 23:59.
 */
export function minuteOfDayIsNap(min: number, w: NapWindow = DEFAULT_NAP_WINDOW): boolean {
  const s = clampMinuteOfDay(w.startMin, NAP_WINDOW_START_DEFAULT);
  const e = clampMinuteOfDay(w.endMin, NAP_WINDOW_END_DEFAULT);
  if (s === e) return false;
  return s < e ? min >= s && min < e : min >= s || min < e;
}

/**
 * Whether a sleep STARTING at `startMs` is a nap.
 *
 * Deliberately keyed on the start, not the wake: Baby Buddy classifies on start
 * only, so anything else flips its answer the moment the record round-trips
 * through the server.
 */
export function isNapStart(startMs: number, w: NapWindow = DEFAULT_NAP_WINDOW): boolean {
  const d = new Date(startMs);
  return minuteOfDayIsNap(d.getHours() * 60 + d.getMinutes(), w);
}

/** Most recent diaper change, or null. */
export function lastDiaper(entries: Entry[]) {
  return entries
    .filter((e): e is Extract<Entry, { type: 'diaper' }> => e.type === 'diaper')
    .sort((a, b) => b.time - a.time)[0];
}

/** Minutes since the most recent diaper change, or null. */
export function lastDiaperMinAgo(entries: Entry[], now: number): number | null {
  const d = lastDiaper(entries);
  return d ? Math.round((now - d.time) / M) : null;
}

/** Whether an "ended when the next activity started" anchor at `tMs` can form a
 *  valid interval: it must land after the current start and no later than now. */
export function endAnchorVisible(tMs: number, startMs: number, now: number): boolean {
  return tMs > startMs && tMs <= now;
}

/**
 * Local midnight of the day containing `ms`, as epoch ms. Cure dates are stored
 * at local midnight, so the "active today" comparison is a plain numeric one
 * against this value. Derived from the store's `now` (not the wall clock) so it
 * is deterministic and clears itself at local midnight the same `now`-keyed way
 * `bathGivenToday` does. Uses setHours rather than ms arithmetic so it stays put
 * across DST boundaries.
 */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Whether a cure is active for `childId` on the day whose local midnight is
 * `todayMidnight`: it must be flagged active, belong to that child, have started
 * on or before today, and either have no end date or one that is today or later.
 * Both boundaries are inclusive, so a cure whose fromDate or toDate is exactly
 * today still counts. Pure numeric compare, no existing helper covered this.
 */
export function isCureActiveToday(cure: Cure, todayMidnight: number, childId: string): boolean {
  return (
    cure.active &&
    cure.childId === childId &&
    cure.fromDate <= todayMidnight &&
    (cure.toDate == null || cure.toDate >= todayMidnight)
  );
}

/**
 * The cures active for one child today, in the order they are stored. An absent
 * `childId` yields `[]` (no child selected, nothing to offer), mirroring
 * `entriesForChild`. Pure, so call it in a render body over a raw-selected
 * `cures` array, NEVER inside a `useAppStore` selector: returning a fresh
 * filtered array from a selector makes zustand v5 loop forever.
 */
export function activeCuresForChildToday(cures: Cure[], childId: string, todayMidnight: number): Cure[] {
  if (!childId) return [];
  return cures.filter((c) => isCureActiveToday(c, todayMidnight, childId));
}
