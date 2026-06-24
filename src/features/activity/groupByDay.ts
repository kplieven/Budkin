import { dayGroupLabel } from '@/lib/format';
import { entryTimestamp, type Entry } from '@/types/models';

export interface DayGroup {
  label: string;
  items: Entry[];
}

/**
 * Sort entries newest-first and bucket them into day groups (Today / Yesterday /
 * date), preserving that order. Shared by the History screen and the desktop
 * timeline rail.
 */
export function groupByDay(entries: Entry[], now: number): DayGroup[] {
  const sorted = [...entries].sort((a, b) => entryTimestamp(b) - entryTimestamp(a));
  const groups: DayGroup[] = [];
  for (const e of sorted) {
    const label = dayGroupLabel(entryTimestamp(e), now);
    let g = groups.find((x) => x.label === label);
    if (!g) {
      g = { label, items: [] };
      groups.push(g);
    }
    g.items.push(e);
  }
  return groups;
}
