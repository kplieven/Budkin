import type { Entry } from '@/types/models';

export const DAY = 86400000;

/** Local midnight (ms) of the calendar day containing `ms`. */
export function dayStart(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Start (local noon) of the noon-to-noon window containing `ms`. */
export function noonWindowStart(ms: number): number {
  const d = new Date(ms);
  const noon = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime();
  return ms >= noon ? noon : noon - DAY;
}

export interface HeatSegment { x0: number; x1: number; nap: boolean }
export interface HeatRow { offsetFromToday: number; segments: HeatSegment[] }

/**
 * One row per noon-to-noon window, newest last. x is noon-origin in [0,1):
 * 0 = noon, 0.5 = midnight, 1 = next noon — so a night is a single contiguous
 * block centred in the row. The bottom row (offsetFromToday 0) is the current,
 * still-filling window: after today's noon it starts fresh and last night sits
 * one row up. Rows span the oldest in-range data window through today
 * inclusive — interior gap days render as empty rows, nothing older than the
 * data is padded, and [] is returned when no sleep falls in range. Sleeps
 * crossing clock-noon spill into two rows.
 */
export function buildSleepHeatmap(entries: Entry[], now: number, days = 28): HeatRow[] {
  const todayWin = noonWindowStart(now);
  const rows = new Map<number, HeatSegment[]>();
  let oldest = -1;
  for (const e of entries) {
    if (e.type !== 'sleep' || e.end == null) continue;
    let start = e.start;
    const end = e.end;
    while (start < end) {
      const win = noonWindowStart(start);
      const segEnd = Math.min(end, win + DAY);
      const offset = Math.round((todayWin - win) / DAY);
      if (offset >= 0 && offset < days) {
        const x0 = (start - win) / DAY;
        const x1 = (segEnd - win) / DAY;
        if (x1 - x0 > 0.001) {
          const arr = rows.get(offset) ?? [];
          arr.push({ x0, x1, nap: e.nap });
          rows.set(offset, arr);
          if (offset > oldest) oldest = offset;
        }
      }
      start = segEnd;
    }
  }
  if (oldest < 0) return [];
  const out: HeatRow[] = [];
  for (let offset = oldest; offset >= 0; offset--) {
    out.push({ offsetFromToday: offset, segments: rows.get(offset) ?? [] });
  }
  return out;
}
