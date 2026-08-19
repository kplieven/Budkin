/**
 * The History timeline's day and activity filters. Kept out of the screen because the
 * day list, the activity list and the filter itself all have to agree about what day
 * an item is on and what activity it counts as.
 */

import { dayGroupLabel, dayKey } from '@/lib/format';
import { ALL_ACTIVITIES } from '@/lib/activities';
import type { ActivityType } from '@/types/models';

import { isTimer, timelineTimestamp, type TimelineItem } from './groupByDay';

export interface TimelineFilter {
  /** `dayKey` of the only day to show, or null for every day. */
  day: string | null;
  /** Activities to show. EMPTY MEANS ALL, not none: it is the cleared state. */
  types: ActivityType[];
}

export interface DayOption {
  key: string;
  /** the same heading the timeline puts above that day's rows */
  label: string;
  count: number;
}

/** A running timer answers with `saveAs`, not `activity`: a quick timer repointed at
 *  sleep belongs under Sleep, the rule Home and the reminder scheduler follow. */
export function itemActivity(item: TimelineItem): ActivityType {
  return isTimer(item) ? item.saveAs : item.type;
}

/**
 * Derived on every render rather than stored with the selection: a day picked as "Today"
 * has to read "Yesterday" once the clock passes midnight. Noon, so the reconstructed
 * instant cannot fall outside its own day on a DST-shifted midnight.
 */
export function dayKeyLabel(key: string, now: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return dayGroupLabel(new Date(y, m - 1, d, 12).getTime(), now);
}

/** The activities actually present, in the app-wide order. A child with no
 *  temperature readings gets no Temperature toggle to press. */
export function activityOptions(items: TimelineItem[]): ActivityType[] {
  const present = new Set(items.map(itemActivity));
  return ALL_ACTIVITIES.filter((a) => present.has(a));
}

/**
 * Built from the items rather than from a calendar, so the picker can only offer a day
 * that has records: History holds roughly the last 50 per activity type, so most calendar
 * dates have nothing behind them. Pass items the other filters have already been applied
 * to and the day list narrows with them.
 */
export function dayOptions(items: TimelineItem[], now: number): DayOption[] {
  const byKey = new Map<string, DayOption>();
  for (const item of items) {
    const ts = timelineTimestamp(item);
    const key = dayKey(ts);
    const seen = byKey.get(key);
    if (seen) seen.count++;
    else byKey.set(key, { key, label: dayKeyLabel(key, now), count: 1 });
  }
  return [...byKey.values()].sort((a, b) => (a.key < b.key ? 1 : -1));
}

/** Apply a filter. Order is untouched, so the caller still owns sorting (the timeline
 *  hands the result to `groupByDay`, which sorts it). */
export function filterItems<T extends TimelineItem>(items: T[], filter: TimelineFilter): T[] {
  const { day, types } = filter;
  if (!day && types.length === 0) return items;
  return items.filter(
    (item) =>
      (!day || dayKey(timelineTimestamp(item)) === day) &&
      (types.length === 0 || types.includes(itemActivity(item))),
  );
}
