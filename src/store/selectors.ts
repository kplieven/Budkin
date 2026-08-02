/**
 * Pure derived computations for the time-entry model and dashboard status.
 * Kept separate from the store so they're trivially unit-testable.
 */

import type { Connection } from '@/data/repository';
import { parseClockInput } from '@/lib/timeParse';
import { normalizeWash, type WashKind } from '@/lib/wash';
import type { ActivityType, BathRhythm, Treatment, TreatmentTimeOfDay, Entry, LastFeed, Measurement, Timer } from '@/types/models';
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
 * Whether the app is talking to a Baby Buddy server, as opposed to local mode or
 * no connection at all. The one predicate for it, because several surfaces gate
 * server-only affordances on it and they have to agree: Home's offline banner
 * and the desktop top bar's pill both feed it to `offlineBannerAction`
 * (`src/features/queue/offlineBanner.ts`), Settings shows its Offline queue row
 * on it, and History marks queued entries on it. Hand-copied, any one of them
 * can be changed without the others, and the app starts contradicting itself
 * about which mode it is in.
 *
 * Takes a structural subset so it doubles as a stable zustand selector:
 * `useAppStore(selectServerMode)`. It returns a BOOLEAN and must keep doing so:
 * a selector that builds a fresh object or array per call makes zustand v5 see a
 * snapshot that never settles, which blank-screens the web build. Callers that
 * already hold `connection` for other reasons can pass `{ connection }` directly
 * instead of taking a second subscription.
 */
export function selectServerMode(s: { connection: Connection | null }): boolean {
  return s.connection?.mode === 'server';
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
 * THE timer ownership rule, in one place: a timer belongs to whoever started it,
 * and to nobody else. Both `timersForChild` and `runningTimer` are built on this,
 * so the repo has one rule instead of two subtly different ones.
 *
 * This USED to adopt: a timer carrying no `childId` of its own counted as the
 * SELECTED child's. Every creation path now stamps an owner, and `hydrate`
 * stamps the ones persisted before that existed, so the fallback bought nothing
 * but a way to file a sibling's nap against the wrong child. A timer that is
 * still unowned by the time it reaches here is one nothing could attribute, and
 * showing it under whoever happens to be selected is exactly the misattribution
 * the stamping removed.
 *
 * `===` against an optional field, so a persisted `null` (AsyncStorage JSON is
 * cast, never parsed) and an absent field both simply match no child.
 */
function timerBelongsTo(t: Timer, childId: string): boolean {
  return t.childId === childId;
}

/**
 * The running timers belonging on one child's history. Scoped exactly like
 * `entriesForChild`: only what the child owns, and nothing at all without a
 * child to scope to, because a permissive fallback resurrects the bug the
 * scoping exists to prevent.
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
  return timers.filter((t) => timerBelongsTo(t, childId));
}

/**
 * The timer running for one child and one kind of activity, or `undefined`. The
 * single answer to "is a sleep (or feeding) timer running right now", so that the
 * dashboard's live sleep total, the Insights heatmap's live bar and the
 * nap-suggestion scheduler cannot drift apart the way they did when each site
 * wrote its own `find`.
 *
 * Keyed on `saveAs`, NEVER on `activity`. `setTimerSaveAs` rewrites `saveAs` and
 * `name` and deliberately leaves `activity` at whatever the timer was started as,
 * so an `activity`-keyed lookup cannot see a quick timer repointed to sleep. That
 * bug is visible: the Insights live bar would be drawn in the feeding colour and
 * then change colour the instant the user stopped the timer, contradicting the
 * timer's own name, its colour on the Timers tab, Home, and the entry it becomes.
 * `saveAs` is what the timer will be written as, which is the one thing every
 * surface already agrees on.
 *
 * ONE child id, because there is one question: whose timer is this. It took a
 * second `selectedChildId` argument for as long as `timerBelongsTo` adopted an
 * unowned timer, so that a caller asking about a sibling could not accidentally
 * hand them one; the rule no longer consults the selection at all, so that
 * argument had nothing left to decide.
 *
 * No child to scope to yields `undefined` rather than the first matching timer,
 * for the reason `entriesForChild` yields `[]`: a permissive fallback resurrects
 * the bug the scoping exists to prevent.
 *
 * Pure, and called in the render body over a raw-selected `timers` array like
 * every other scoping helper here. It returns an element of that array rather
 * than a fresh one, so unlike `timersForChild` a selector-resident call would not
 * by itself loop zustand v5; keep it out of `useAppStore` selectors anyway, so
 * that "derive in render, never in a selector" stays a rule with no exceptions to
 * reason about and nothing allocates on every selector call.
 */
export function runningTimer(timers: Timer[], saveAs: ActivityType, childId: string | undefined): Timer | undefined {
  if (!childId) return undefined;
  return timers.find((t) => t.saveAs === saveAs && timerBelongsTo(t, childId));
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

/**
 * The feeding prefill for a child with nothing logged yet, and the value the
 * store boots on. Breast on the left is the neutral opening pair; `openSheet`
 * alternates the side from it, so a fresh sheet suggests the right.
 */
export const LAST_FEED_DEFAULT: LastFeed = { feedType: 'breast', method: 'left' };

/**
 * One child's last feed: their own stored draft if they have one, else
 * `fallback`. Exactly `rhythmForChild`'s shape and for the same reason.
 *
 * `fallback` is where the pre-map migration lives. A build before this map kept
 * ONE account-wide value, and it is consulted here rather than seeded into the
 * map by a hydration pass: no write, no ordering dependency, idempotent (see
 * `legacyBathRhythm`). It reads as "every child inherits the old value" on the
 * first launch and degrades to per-child as each child gets a real save.
 *
 * No child to scope to yields the fallback, not somebody else's draft: this is
 * a seed the sheet SAVES, so a permissive read files one child's habits as
 * another's.
 */
export function lastFeedForChild(
  map: Record<string, LastFeed>,
  childId: string | undefined,
  fallback: LastFeed,
): LastFeed {
  return (childId ? map[childId] : undefined) ?? fallback;
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

const DAY = 24 * 60 * M;

/**
 * The built-in rhythm for a child with nothing configured: a full bath every 3
 * days, a quick wash daily. Three matches the mainstream 2-to-3-full-baths-a-week
 * guidance for an infant.
 */
export const BATH_RHYTHM_DEFAULT: BathRhythm = { fullEveryDays: 3, quickEveryDays: 1 };

/**
 * 0 to 30 days. 0 is not a degenerate value here, it is the OFF switch: that
 * kind of wash never comes due. This reverses the old count-model rule, which
 * banned 0 because an empty lookback window made `every()` vacuously true and
 * latched "big wash due" forever. That hazard is gone with the counting. Do not
 * restore a minimum of 1 on the strength of the old comment.
 *
 * 30 is a soft cap: far past any rhythm a person keeps, but low enough that a
 * typo like 500 is caught rather than quietly meaning "never".
 */
export const BATH_INTERVAL_MIN = 0;
export const BATH_INTERVAL_MAX = 30;

/**
 * Coerce one interval into range. A non-finite value returns `fallback` rather
 * than 0, because silently switching a reminder off is worse than keeping the
 * previous cadence.
 */
export function clampBathInterval(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(BATH_INTERVAL_MAX, Math.max(BATH_INTERVAL_MIN, Math.round(n)));
}

/** Coerce a whole rhythm, filling each missing axis from `fallback`. */
export function clampBathRhythm(r: Partial<BathRhythm> | undefined, fallback: BathRhythm): BathRhythm {
  return {
    fullEveryDays: clampBathInterval(r?.fullEveryDays ?? fallback.fullEveryDays, fallback.fullEveryDays),
    quickEveryDays: clampBathInterval(r?.quickEveryDays ?? fallback.quickEveryDays, fallback.quickEveryDays),
  };
}

/**
 * The rhythm implied by the pre-2026-08 global pref, used as the fallback for a
 * child with nothing stored. `smallWashesPerBig: 3` meant a full bath on the 4th
 * bath of the cycle, which on daily bathing is every 4 days, so the translation
 * is `+ 1`. That preserves the cadence an existing user already feels; a fresh
 * install with no legacy value gets `BATH_RHYTHM_DEFAULT` instead.
 *
 * Stateless on purpose. Deriving the fallback on read rather than running a
 * seeding pass at hydration means no write, no ordering dependency between prefs
 * and children loading, and it stays idempotent.
 */
export function legacyBathRhythm(smallWashesPerBig: number | undefined): BathRhythm {
  if (smallWashesPerBig == null || !Number.isFinite(smallWashesPerBig)) return BATH_RHYTHM_DEFAULT;
  return {
    fullEveryDays: clampBathInterval(Math.round(smallWashesPerBig) + 1, BATH_RHYTHM_DEFAULT.fullEveryDays),
    quickEveryDays: 1,
  };
}

/** One child's rhythm: their stored entry if they have one, else `fallback`. */
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
  /** a full bath is due today or overdue */
  full: boolean;
  /** a quick wash is due today or overdue */
  quick: boolean;
  /** what to pre-select in the log sheet; `full` wins when both are due */
  nextKind: WashKind;
  /** the sooner upcoming wash, or null while one is already due or both are off */
  upcoming: WashUpcoming | null;
}

/**
 * What each kind of wash owes today, from the child's rhythm and their bath
 * history.
 *
 * The load-bearing asymmetry: ANY bath resets the quick-wash clock, but only a
 * FULL bath resets the full-bath clock. A full bath is a quick wash and more, so
 * it satisfies the lesser obligation. That is what lets the same two numbers
 * describe a newborn (full off, quick 1) and a toddler (full 1, quick 1): once
 * full baths are daily, every bath resets the quick clock, so the quick wash
 * stops surfacing on its own without anyone disabling it.
 *
 * Distance is measured in local CALENDAR days, not 24-hour blocks, because the
 * schedule is a bedtime routine: a Monday evening bath reads as two days by
 * Wednesday morning. `Math.round` over the `startOfDay` difference absorbs the
 * 23 and 25-hour days at a DST boundary.
 *
 * Derived from history on every call, never from a stored counter, so editing an
 * interval re-reads the existing baths immediately. Never bathed means due.
 *
 * Pure and `now`-parametrised: scope the entries to the child first
 * (`entriesForChild`), exactly like the other status helpers.
 */
export function washDueState(entries: Entry[], rhythm: BathRhythm, now: number): WashDue {
  const baths = entries
    .filter((e): e is Extract<Entry, { type: 'bath' }> => e.type === 'bath')
    .sort((a, b) => b.time - a.time);
  const today = startOfDay(now);
  const daysSince = (e: { time: number } | undefined): number | null =>
    e ? Math.round((today - startOfDay(e.time)) / DAY) : null;

  const fullEvery = clampBathInterval(rhythm.fullEveryDays, BATH_RHYTHM_DEFAULT.fullEveryDays);
  const quickEvery = clampBathInterval(rhythm.quickEveryDays, BATH_RHYTHM_DEFAULT.quickEveryDays);

  // normalizeWash rather than a raw `b.wash === 'full'` compare: a bath still
  // sitting in the offline queue or pending-ops log from before the 2026-08
  // rename carries the literal legacy `'big'`, and neither store runs it
  // through entityStore.ts's load-time normalization, so a bare compare here
  // would leave a legacy full bath unable to ever reset this clock.
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
 * Local midnight of the day containing `ms`, as epoch ms. Treatment dates are stored
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
 * Whether a treatment is active for `childId` on the day whose local midnight is
 * `todayMidnight`: it must be flagged active, belong to that child, have started
 * on or before today, and either have no end date or one that is today or later.
 * Both boundaries are inclusive, so a treatment whose fromDate or toDate is exactly
 * today still counts. Pure numeric compare, no existing helper covered this.
 */
export function isTreatmentActiveToday(treatment: Treatment, todayMidnight: number, childId: string): boolean {
  return (
    treatment.active &&
    treatment.childId === childId &&
    treatment.fromDate <= todayMidnight &&
    (treatment.toDate == null || treatment.toDate >= todayMidnight)
  );
}

/**
 * The treatments active for one child today, in the order they are stored. An absent
 * `childId` yields `[]` (no child selected, nothing to offer), mirroring
 * `entriesForChild`. Pure, so call it in a render body over a raw-selected
 * `treatments` array, NEVER inside a `useAppStore` selector: returning a fresh
 * filtered array from a selector makes zustand v5 loop forever.
 */
export function activeTreatmentsForChildToday(treatments: Treatment[], childId: string, todayMidnight: number): Treatment[] {
  if (!childId) return [];
  return treatments.filter((c) => isTreatmentActiveToday(c, todayMidnight, childId));
}

/**
 * The wall-clock hour each coarse time of day is dosed at. Fixed rather than a
 * setting: the four labels only need to be ordered and roughly right for a dose
 * to read as due at the expected part of the day, and a wrong-by-an-hour slot
 * costs nothing (the dose stays due until it is given, it never lapses).
 */
export const TREATMENT_TIME_OF_DAY_HOUR: Record<TreatmentTimeOfDay, number> = {
  morning: 8,
  noon: 12,
  evening: 18,
  night: 22,
};

/** Today's wall-clock ms for one time-of-day slot. Built with setHours off the
 *  day's midnight rather than by adding hours, so it stays on the intended hour
 *  across a DST boundary. */
export function timeOfDaySlotMs(todayMidnight: number, tod: TreatmentTimeOfDay): number {
  const d = new Date(todayMidnight);
  d.setHours(TREATMENT_TIME_OF_DAY_HOUR[tod], 0, 0, 0);
  return d.getTime();
}

/**
 * A dose is attributed to a treatment BY NAME (trimmed, case-insensitive), because a
 * `MedicationEntry` carries no reference back to the treatment it came from and
 * cannot be given one: Baby Buddy has no such field, so a `treatmentId` would be
 * dropped the moment the dose round-trips through the server and a dose logged
 * on another device would stop counting. Name matching is the only rule that
 * survives sync. Same normalisation as `matchServerChild`.
 */
const normName = (s: string) => s.trim().toLowerCase();

function dosesForTreatment(entries: Entry[], treatment: Treatment): Extract<Entry, { type: 'medication' }>[] {
  const name = normName(treatment.name);
  return entries.filter(
    (e): e is Extract<Entry, { type: 'medication' }> => e.type === 'medication' && normName(e.name) === name,
  );
}

/** How a treatment stands right now: how many of its doses are owed, and how many
 *  today expected at all (which is what separates "nothing due yet" from
 *  "everything given" for the done badge). */
export interface TreatmentDue {
  treatment: Treatment;
  /** doses that are owed now: their moment has passed and none was logged for it */
  due: number;
  /** doses today's schedule called for at all, given or not */
  expected: number;
}

/**
 * Whether a treatment owes a dose right now, and how many doses today asked for.
 *
 * Times-of-day treatments count rather than match slot-to-dose: `due` is the number
 * of slots already reached today minus the doses logged today, floored at zero.
 * Counting is what makes a late dose behave: dosing once at 19:00 on a
 * morning+evening treatment settles one of the two owed doses and leaves the other
 * owed, where a per-slot "any dose after this slot clears it" rule would let
 * that single evening dose silently clear the skipped morning one too.
 *
 * Interval treatments owe at most ONE dose at a time (the app shows a single due
 * state, so counting missed intervals would only inflate the number without
 * telling the user anything new). An interval treatment that has never been dosed is
 * owed immediately: `isTreatmentActiveToday` has already established that its
 * `fromDate` has passed, so the regimen has started and the first dose is late.
 *
 * Pure and `now`-parametrised. Scope `entries` to the child first.
 */
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

  const reached = (treatment.timesOfDay ?? []).filter((tod) => now >= timeOfDaySlotMs(todayMidnight, tod)).length;
  return { treatment, due: Math.max(0, reached - dosesToday), expected: reached };
}

/**
 * The two per-treatment dose facts the reminder layer needs, keyed by treatment
 * id: how many doses were logged today, and the instant of the most recent one.
 *
 * Lives here rather than in the notifications layer so that dose-to-treatment
 * name attribution has exactly one home. Both figures are computed the same way
 * `treatmentDueState` computes them, including the `e.time <= now` bound that
 * keeps a dose stamped in the future from counting as already given.
 *
 * Every treatment passed in gets an entry, including one with no doses on
 * record, so a caller can tell "no doses" apart from "treatment not
 * considered". Scope `entries` to the child first.
 */
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

/**
 * The due state of every treatment active for one child today, due ones FIRST (the
 * log picker lists them in this order, and the order is stable within each group
 * so an undue treatment never jumps around as `now` ticks).
 *
 * Pure, so call it in a render body over raw-selected arrays, NEVER inside a
 * `useAppStore` selector: returning a fresh array from a selector makes zustand
 * v5 loop forever.
 */
export function treatmentDueList(treatments: Treatment[], childId: string | undefined, entries: Entry[], now: number): TreatmentDue[] {
  if (!childId) return [];
  return activeTreatmentsForChildToday(treatments, childId, startOfDay(now))
    .map((c) => treatmentDueState(c, entries, now))
    .sort((a, b) => (a.due > 0 ? 0 : 1) - (b.due > 0 ? 0 : 1));
}

/** Total doses owed across a child's active treatments. */
export function totalTreatmentDue(list: TreatmentDue[]): number {
  return list.reduce((sum, d) => sum + d.due, 0);
}

/**
 * The Medication tile's hint, mirroring how the Bath tile phrases its wash. One
 * owed dose names its treatment ("Omeprazol due") because that is the whole
 * answer at a glance; more than one can't be named, so it counts instead.
 * `null` means the tile has nothing to say and should keep its default copy.
 */
export function treatmentDueHint(list: TreatmentDue[]): string | null {
  if (list.length === 0) return null;
  const due = totalTreatmentDue(list);
  if (due === 1) {
    const owed = list.find((d) => d.due > 0);
    return owed ? `${owed.treatment.name.trim()} due` : null;
  }
  if (due > 1) return `${due} doses due`;
  // Nothing owed: distinguish a day whose doses are all given from one whose
  // first dose simply isn't due yet, exactly as the Bath tile separates
  // "Washed today" from a forward-looking hint.
  return list.some((d) => d.expected > 0) ? 'All doses given' : 'Nothing due';
}

/** Whether the Medication tile shows the "done for today" check: doses were
 *  called for today and every one of them is logged. A child with no treatments, or
 *  one whose first dose is still ahead, gets no check. */
export function treatmentsAllGiven(list: TreatmentDue[]): boolean {
  return list.length > 0 && totalTreatmentDue(list) === 0 && list.some((d) => d.expected > 0);
}
