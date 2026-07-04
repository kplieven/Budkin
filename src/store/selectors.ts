/**
 * Pure derived computations for the time-entry model and dashboard status.
 * Kept separate from the store so they're trivially unit-testable.
 */

import type { Entry } from '@/types/models';
import type { TimeEntryState, TimeField } from '@/types/timeEntry';

const M = 60000;

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

function endPinned(te: TimeEntryState, now: number): number {
  return te.endAbs ?? now - (te.endAgoMin ?? 0) * M;
}
function startPinned(te: TimeEntryState, now: number): number {
  return te.startAbs ?? now;
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

/** Minutes since the most recent completed sleep ended (woke), or null. */
export function lastWakeMinAgo(entries: Entry[], now: number): number | null {
  const s = entries
    .filter((e): e is Extract<Entry, { type: 'sleep' }> => e.type === 'sleep' && e.end != null)
    .sort((a, b) => (b.end as number) - (a.end as number))[0];
  return s ? Math.round((now - (s.end as number)) / M) : null;
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
