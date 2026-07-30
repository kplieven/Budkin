import type { Entry, Timer } from '@/types/models';

export const DAY = 86400000;

/** Local midnight (ms) of the calendar day containing `ms`. */
export function dayStart(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Start (ms) of the 24h window anchored at `originHour` (0..23, local time)
 * that contains `ms`. originHour 12 is the classic noon-to-noon window (a
 * normal night lands as one contiguous block in the middle); 0 gives calendar
 * days; 19 an evening-anchored window. This is the tab's single day boundary —
 * both the heatmap and the per-window trend bucketing use it, so the graph and
 * the numbers agree.
 */
export function windowStart(ms: number, originHour: number): number {
  const d = new Date(ms);
  const origin = new Date(d.getFullYear(), d.getMonth(), d.getDate(), originHour).getTime();
  return ms >= origin ? origin : origin - DAY;
}

/** Start (local noon) of the noon-to-noon window containing `ms`. */
export function noonWindowStart(ms: number): number {
  return windowStart(ms, 12);
}

export type TrendMetric = 'totalSleep' | 'longestStretch' | 'wakeWindow' | 'feedsPerDay' | 'feedInterval';
export interface TrendPoint { t: number; value: number }

export interface HeatSegment { x0: number; x1: number; nap: boolean }
/** A drawable interval in [0,1) origin coordinates (a feeding block). */
export interface HeatBar { x0: number; x1: number }
export interface HeatRow {
  offsetFromToday: number;
  /** sleep intervals (night vs nap) */
  segments: HeatSegment[];
  /** completed feeding intervals, drawn over sleep so feeding wins any overlap */
  feeds: HeatBar[];
  /** diaper event x-positions in [0,1), drawn as full-height vertical bars */
  diapers: number[];
}

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
export function buildSleepHeatmap(entries: Entry[], now: number, days = 28, originHour = 12): HeatRow[] {
  const todayWin = windowStart(now, originHour);
  const rows = new Map<number, HeatSegment[]>();
  let oldest = -1;
  for (const e of entries) {
    if (e.type !== 'sleep' || e.end == null) continue;
    let start = e.start;
    const end = e.end;
    while (start < end) {
      const win = windowStart(start, originHour);
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

  // Feeding intervals (split across the origin seam like sleep) and diaper points,
  // bucketed into the same windows as the sleep band. Only rows that already exist
  // (0..oldest) get markers — the heatmap stays anchored on sleep. An in-progress
  // feed (end == null) is left out here; it's drawn as the live feeding bar.
  const feedsByOffset = new Map<number, HeatBar[]>();
  const diapersByOffset = new Map<number, number[]>();
  for (const e of entries) {
    if (e.type === 'feeding') {
      if (e.end == null) continue;
      let start = e.start;
      const end = e.end;
      while (start < end) {
        const win = windowStart(start, originHour);
        const segEnd = Math.min(end, win + DAY);
        const offset = Math.round((todayWin - win) / DAY);
        if (offset >= 0 && offset <= oldest) {
          const x0 = (start - win) / DAY;
          const x1 = (segEnd - win) / DAY;
          if (x1 - x0 > 0.001) (feedsByOffset.get(offset) ?? feedsByOffset.set(offset, []).get(offset)!).push({ x0, x1 });
        }
        start = segEnd;
      }
    } else if (e.type === 'diaper') {
      const win = windowStart(e.time, originHour);
      const offset = Math.round((todayWin - win) / DAY);
      if (offset < 0 || offset > oldest) continue;
      (diapersByOffset.get(offset) ?? diapersByOffset.set(offset, []).get(offset)!).push((e.time - win) / DAY);
    }
  }

  const out: HeatRow[] = [];
  for (let offset = oldest; offset >= 0; offset--) {
    out.push({
      offsetFromToday: offset,
      segments: rows.get(offset) ?? [],
      feeds: feedsByOffset.get(offset) ?? [],
      diapers: diapersByOffset.get(offset) ?? [],
    });
  }
  return out;
}

/**
 * Milliseconds of completed sleep falling inside the single window
 * [winStart, winStart + DAY). A sleep straddling either boundary contributes
 * only its overlapping part, so the portion before the window counts to the
 * previous day and the portion after to the next — the same seam the heatmap
 * and the totalSleep trend use. In-progress sleeps (end == null) are ignored.
 */
export function sleepMsInWindow(entries: Entry[], winStart: number): number {
  const winEnd = winStart + DAY;
  let ms = 0;
  for (const e of entries) {
    if (e.type !== 'sleep' || e.end == null) continue;
    ms += Math.max(0, Math.min(e.end, winEnd) - Math.max(e.start, winStart));
  }
  return ms;
}

/**
 * `sleepMsInWindow` plus the part of any still-running sleep timer that has
 * already elapsed inside the window — the "sleep so far today" number Home
 * shows. Pass `now` from the store's ticking clock and it counts up live.
 *
 * A running timer is clipped to the window on both sides, exactly like a
 * completed sleep: a nap that began before `winStart` contributes only its
 * in-window part, and a `now` past the window end stops the count at the
 * boundary. A `now` before the timer's start (clock skew, bad persisted data)
 * contributes 0, never a negative.
 *
 * A timer counts by `saveAs`, not `activity`: `saveAs` is what the timer will
 * actually be written as when stopped, so a quick timer started as feeding and
 * switched to sleep belongs in this total. Timers are NOT scoped to a child
 * here — pass `timersForChild(...)` output, the same way `entries` must already
 * be `entriesForChild(...)` output. Every running sleep timer in the array
 * contributes, so two overlapping ones double-count. That state is reachable
 * (start two quick timers, set both to save as sleep) but deliberately not
 * defended against here: `sleepMsInWindow` does not deduplicate overlapping
 * completed sleeps either, so the number is the same before and after those
 * timers stop. Filtering by child is what keeps a sibling's nap out.
 *
 * Deliberately a separate function rather than an option on `sleepMsInWindow`:
 * "logged sleep" and "sleep so far, live" are two different questions, and a
 * defaulted argument would hide which one a call site is asking. Note that the
 * totalSleep trend and the heatmap do not go through `sleepMsInWindow` at all —
 * each repeats the boundary split inline.
 */
export function liveSleepMsInWindow(entries: Entry[], timers: Timer[], winStart: number, now: number): number {
  const winEnd = winStart + DAY;
  let ms = sleepMsInWindow(entries, winStart);
  for (const tm of timers) {
    if (tm.saveAs !== 'sleep') continue;
    ms += Math.max(0, Math.min(now, winEnd) - Math.max(tm.start, winStart));
  }
  return ms;
}

export interface DiaperDay { t: number; wet: number; dirty: number }

export function buildDiaperSeries(entries: Entry[], now: number, rangeDays: number, originHour = 12): DiaperDay[] {
  const cutoff = now - rangeDays * DAY;
  const byDay = new Map<number, { wet: number; dirty: number }>();
  for (const e of entries) {
    if (e.type !== 'diaper' || e.time < cutoff) continue;
    const d = windowStart(e.time, originHour);
    const cur = byDay.get(d) ?? { wet: 0, dirty: 0 };
    if (e.wet) cur.wet += 1;   // wet and dirty are independent signals —
    if (e.solid) cur.dirty += 1; // a both-diaper increments each, never their sum
    byDay.set(d, cur);
  }
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, wet: v.wet, dirty: v.dirty }));
}

const HOUR = 3600000;

export function buildTrend(entries: Entry[], metric: TrendMetric, now: number, rangeDays: number, originHour = 12): TrendPoint[] {
  const cutoff = now - rangeDays * DAY;

  if (metric === 'feedsPerDay' || metric === 'feedInterval') {
    const byDay = new Map<number, number[]>();
    for (const e of entries) {
      if (e.type !== 'feeding' || e.start < cutoff) continue;
      const d = windowStart(e.start, originHour);
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

  if (metric === 'totalSleep') {
    // Split each sleep at the window boundaries so the part before a boundary
    // counts to the previous window and the part after to the next — the same
    // seam the heatmap draws, so the graph and this number agree on a straddler.
    const msByWin = new Map<number, number>();
    for (const e of entries) {
      if (e.type !== 'sleep' || e.end == null || e.end < cutoff) continue;
      let start = e.start;
      const end = e.end;
      while (start < end) {
        const win = windowStart(start, originHour);
        const segEnd = Math.min(end, win + DAY);
        msByWin.set(win, (msByWin.get(win) ?? 0) + (segEnd - start));
        start = segEnd;
      }
    }
    return [...msByWin.entries()].sort((a, b) => a[0] - b[0]).map(([t, ms]) => ({ t, value: ms / HOUR }));
  }

  // longestStretch and wakeWindow stay bucketed by the window a sleep STARTS in:
  // a continuous stretch and the awake gaps around it are single things, not
  // durations to apportion, so splitting them at a boundary would distort them.
  const byWin = new Map<number, { start: number; end: number }[]>();
  for (const e of entries) {
    if (e.type !== 'sleep' || e.end == null || e.end < cutoff) continue;
    const w = windowStart(e.start, originHour);
    (byWin.get(w) ?? byWin.set(w, []).get(w)!).push({ start: e.start, end: e.end });
  }
  const out: TrendPoint[] = [];
  for (const [w, sleeps] of [...byWin.entries()].sort((a, b) => a[0] - b[0])) {
    sleeps.sort((a, b) => a.start - b.start);
    if (metric === 'longestStretch') {
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
