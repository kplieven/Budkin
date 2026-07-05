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
 * One row per noon-to-noon day, newest last. x is noon-origin in [0,1):
 * 0 = noon, 0.5 = midnight, 1 = next noon — so a normal night is a single
 * contiguous block centred in the row. Sleeps crossing noon spill to two rows.
 */
export function buildSleepHeatmap(entries: Entry[], now: number, days = 28): HeatRow[] {
  const todayWin = noonWindowStart(now) - DAY;
  const rows = new Map<number, HeatSegment[]>();
  let maxOffset = 0;
  for (const e of entries) {
    if (e.type !== 'sleep' || e.end == null) continue;
    let start = e.start;
    const end = e.end;
    while (start < end) {
      const win = noonWindowStart(start);
      const segEnd = Math.min(end, win + DAY);
      const offset = Math.round((todayWin - win) / DAY);
      if (offset >= -1 && offset < days) {
        const x0 = (start - win) / DAY;
        const x1 = (segEnd - win) / DAY;
        if (x1 - x0 > 0.001) {
          const arr = rows.get(offset) ?? [];
          arr.push({ x0, x1, nap: e.nap });
          rows.set(offset, arr);
          if (offset > maxOffset) maxOffset = offset;
        }
      }
      start = segEnd;
    }
  }
  let minOffset = 0;
  if (rows.size > 0) {
    minOffset = Math.min(...Array.from(rows.keys()));
  }
  const out: HeatRow[] = [];
  for (let offset = maxOffset; offset >= minOffset; offset--) {
    out.push({ offsetFromToday: offset, segments: rows.get(offset) ?? [] });
  }
  return out;
}
