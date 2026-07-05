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

export type TrendMetric = 'totalSleep' | 'longestStretch' | 'wakeWindow' | 'feedsPerDay' | 'feedInterval';
export interface TrendPoint { t: number; value: number }

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

const HOUR = 3600000;

export function buildTrend(entries: Entry[], metric: TrendMetric, now: number, rangeDays: number): TrendPoint[] {
  const cutoff = now - rangeDays * DAY;

  if (metric === 'feedsPerDay' || metric === 'feedInterval') {
    const byDay = new Map<number, number[]>();
    for (const e of entries) {
      if (e.type !== 'feeding' || e.start < cutoff) continue;
      const d = dayStart(e.start);
      (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(e.start);
    }
    const out: TrendPoint[] = [];
    for (const [d, starts] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
      if (metric === 'feedsPerDay') { out.push({ t: d, value: starts.length }); continue; }
      if (starts.length < 2) continue;
      starts.sort((a, b) => a - b);
      let sum = 0;
      for (let i = 1; i < starts.length; i++) sum += starts[i] - starts[i - 1];
      out.push({ t: d, value: sum / (starts.length - 1) / HOUR });
    }
    return out;
  }

  const byWin = new Map<number, { start: number; end: number }[]>();
  for (const e of entries) {
    if (e.type !== 'sleep' || e.end == null || e.end < cutoff) continue;
    const w = noonWindowStart(e.start);
    (byWin.get(w) ?? byWin.set(w, []).get(w)!).push({ start: e.start, end: e.end });
  }
  const out: TrendPoint[] = [];
  for (const [w, sleeps] of [...byWin.entries()].sort((a, b) => a[0] - b[0])) {
    sleeps.sort((a, b) => a.start - b.start);
    if (metric === 'totalSleep') {
      out.push({ t: w, value: sleeps.reduce((s, x) => s + (x.end - x.start), 0) / HOUR });
    } else if (metric === 'longestStretch') {
      out.push({ t: w, value: Math.max(...sleeps.map((x) => x.end - x.start)) / HOUR });
    } else {
      const gaps: number[] = [];
      for (let i = 1; i < sleeps.length; i++) {
        const gap = sleeps[i].start - sleeps[i - 1].end;
        if (gap > 0 && gap < 6 * HOUR) gaps.push(gap);
      }
      if (gaps.length) out.push({ t: w, value: gaps.reduce((s, g) => s + g, 0) / gaps.length / 60000 });
    }
  }
  return out;
}
