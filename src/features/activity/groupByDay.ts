import { dayGroupLabel } from '@/lib/format';
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
 */
export function groupByDay<T extends TimelineItem>(items: T[], now: number): DayGroup<T>[] {
  const sorted = [...items].sort((a, b) => timelineTimestamp(b) - timelineTimestamp(a));
  const groups: DayGroup<T>[] = [];
  for (const e of sorted) {
    const label = dayGroupLabel(timelineTimestamp(e), now);
    let g = groups.find((x) => x.label === label);
    if (!g) {
      g = { label, items: [] };
      groups.push(g);
    }
    g.items.push(e);
  }
  return groups;
}
