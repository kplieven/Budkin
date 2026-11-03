import { startOfDay } from '@/lib/calendarMonth';

const HISTORY_DAYS = 14;

/** Complete local-calendar days, including across daylight-saving changes. */
export function recentHistorySince(now: number): number {
  const d = new Date(startOfDay(now));
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - HISTORY_DAYS).getTime();
}

export function olderHistorySince(sinceMs: number): number {
  const d = new Date(sinceMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - HISTORY_DAYS).getTime();
}
