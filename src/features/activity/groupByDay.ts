import { dayGroupLabel, dayKey } from '@/lib/format';
import { entryTimestamp, type Entry, type Timer } from '@/types/models';

/**
 * What the activity timeline can show: something already logged, or a timer
 * that is still running.
 *
 * A running timer stays its own type rather than being adapted into a synthetic
 * entry. It has no id in `entries`, so a fake one would flow into `openEdit`
 * and silently no-op there (that lookup returns early on a miss), and the row
 * has to dispatch its tap to `openTimerEdit` anyway.
 */
export type TimelineItem = Entry | Timer;

/** Narrow a timeline item to the running-timer case. `saveAs` exists only on
 *  `Timer`, so it discriminates the union with no tag field needed. */
export function isTimer(item: TimelineItem): item is Timer {
  return 'saveAs' in item;
}

/** Where an item sits on the timeline. A running timer has no end, so it sorts
 *  at its start, exactly as an entry with `end: null` does (`entryTimestamp`).
 *  A timer is therefore interleaved with the entries around its start, not
 *  pinned to the top of the list. */
export function timelineTimestamp(item: TimelineItem): number {
  return isTimer(item) ? item.start : entryTimestamp(item);
}

export interface DayGroup<T extends TimelineItem = TimelineItem> {
  label: string;
  items: T[];
}

/**
 * Sort items newest-first and bucket them into day groups (Today / Yesterday /
 * date), preserving that order. Shared by the History screen, the desktop
 * timeline rail and the Notes tab.
 *
 * Generic in the item type so widening it to accept timers costs the entry-only
 * callers nothing: pass `NoteEntry[]` and the groups still hold `NoteEntry`.
 *
 * Written to stay flat in the number of items, because History re-runs it on
 * every render over the child's WHOLE timeline. Two things it therefore does not
 * do: derive a timestamp inside the comparator, and reach for `dayGroupLabel`
 * per item. See the two comments below.
 */
export function groupByDay<T extends TimelineItem>(items: T[], now: number): DayGroup<T>[] {
  // Decorate-sort-undecorate. `timelineTimestamp` is a type test plus a branch
  // per entry shape, and a bare comparator re-derives it O(n log n) times.
  const dated = items.map((item) => ({ item, ts: timelineTimestamp(item) }));
  dated.sort((a, b) => b.ts - a.ts);

  // Bucket by calendar-day KEY, and label each bucket once, when it is created.
  // Bucketing by the label instead is correct (a label is 1:1 with a day) but
  // pays `dayGroupLabel`'s three Date allocations for every ITEM, on top of a
  // linear scan of the buckets to find the match: O(items x days). A Map keeps
  // its insertion order, so the groups still come out in the sorted order the
  // items arrived in, newest day first.
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
