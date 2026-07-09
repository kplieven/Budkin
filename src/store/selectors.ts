/**
 * Pure derived computations for the time-entry model and dashboard status.
 * Kept separate from the store so they're trivially unit-testable.
 */

import type { Entry, Measurement } from '@/types/models';
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

/**
 * The wash due next, from the user's rhythm: a "small wash" most days, a "big
 * wash" every few days. Rule: if the three most recent washes are all small,
 * a big wash is due; otherwise small. Fewer than three washes (or none) → small.
 */
export function nextWashKind(entries: Entry[]): 'small' | 'big' {
  const recent = entries
    .filter((e): e is Extract<Entry, { type: 'bath' }> => e.type === 'bath')
    .sort((a, b) => b.time - a.time)
    .slice(0, 3);
  return recent.length === 3 && recent.every((b) => b.wash === 'small') ? 'big' : 'small';
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
