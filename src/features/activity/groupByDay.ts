import { dayGroupLabel, dayKey } from '@/lib/format';
import { entryTimestamp, type Entry, type Timer } from '@/types/models';

/**
 * A running timer stays its own type rather than being adapted into a synthetic entry.
 * It has no id in `entries`, so a fake one would flow into `openEdit` and silently no-op
 * there, and the row has to dispatch its tap to `openTimerEdit` anyway.
 */
export type TimelineItem = Entry | Timer;

/** `saveAs` exists only on `Timer`, so it discriminates the union with no tag field. */
export function isTimer(item: TimelineItem): item is Timer {
  return 'saveAs' in item;
}

/** A running timer has no end, so it sorts at its start, as an entry with `end: null`
 *  does, and interleaves with the entries around it rather than pinning to the top. */
export function timelineTimestamp(item: TimelineItem): number {
  return isTimer(item) ? item.start : entryTimestamp(item);
}

export interface DayGroup<T extends TimelineItem = TimelineItem> {
  label: string;
  items: T[];
}

/**
 * Sort items newest-first and bucket them into day groups, preserving that order.
 *
 * Generic in the item type so widening it to accept timers costs the entry-only callers
 * nothing: pass `NoteEntry[]` and the groups still hold `NoteEntry`. Written to stay flat
 * in the number of items, because History re-runs it on every render over the child's
 * whole timeline.
 */
export function groupByDay<T extends TimelineItem>(items: T[], now: number): DayGroup<T>[] {
  // Decorate-sort-undecorate. `timelineTimestamp` is a type test plus a branch per entry
  // shape, and a bare comparator re-derives it O(n log n) times.
  const dated = items.map((item) => ({ item, ts: timelineTimestamp(item) }));
  dated.sort((a, b) => b.ts - a.ts);

  // Bucket by calendar-day KEY and label each bucket once, when it is created. Bucketing
  // by the label is correct (a label is 1:1 with a day) but pays `dayGroupLabel`'s three
  // Date allocations for every item, plus a linear scan of the buckets to find the match.
  // A Map keeps insertion order, so the groups still come out newest day first.
  const byKey = new Map<string, DayGroup<T>>();
  for (const { item, ts } of dated) {
    const key = dayKey(ts);
    let g = byKey.get(key);
    if (!g) {
      g = { label: dayGroupLabel(ts, now), items: [] };
      byKey.set(key, g);
    }
    g.items.push(item);
  }
  return [...byKey.values()];
}
