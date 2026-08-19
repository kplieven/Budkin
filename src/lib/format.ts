/**
 * Time and duration formatters. All "now"-relative helpers take `now` (ms)
 * explicitly so they stay pure.
 */

/** 24-hour clock, "14:47" / "09:05" */
export function fmtClock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "20 min" / "1h 30m" / "1h" */
export function fmtDur(min: number): string {
  min = Math.max(0, Math.round(min));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** "just now" / "5m ago" / "1h 5m ago" */
export function fmtAgo(ms: number, now: number): string {
  const min = Math.round((now - ms) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  if (min < 1440) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h}h ${m}m ago` : `${h}h ago`;
  }
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  return h ? `${d}d ${h}h ago` : `${d}d ago`;
}

/**
 * Compact form for stat values and anchors: "5m" / "1h18m". Floors at zero because a
 * negative elapsed is reachable: an ongoing entry can carry a start the user set ahead of
 * the clock, and History reads a minute-quantized `now` that sits behind real time.
 */
export function fmtAgoShort(min: number): string {
  min = Math.max(0, min);
  if (min < 60) return `${min}m`;
  if (min < 1440) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h}h${m}m` : `${h}h`;
  }
  return `${Math.floor(min / 1440)}d`;
}

/** Base copy for the Quick set anchor chips, shared so the start, end and point-event
 *  panels word them identically. */
export const ANCHOR_LABEL = {
  feedEnded: 'Feed ended',
  woke: 'Woke',
  diaper: 'Diaper',
  feedStarted: 'Feed started',
  sleepStarted: 'Sleep started',
} as const;

/** anchorLabel('Feed ended', 120) -> "Feed ended (2h)", anchorLabel('Woke') -> "Woke". */
export function anchorLabel(base: string, agoMin?: number): string {
  return agoMin == null ? base : `${base} (${fmtAgoShort(agoMin)})`;
}

/** Days in the approximate month `ageStr` and `ageMonths` count in. Exported because
 *  scheduling has to hit the exact instant `ageMonths` ticks over (`catchUpDueAt` in
 *  src/lib/milestones.ts), which it cannot do from a calendar month. */
export const APPROX_MONTH_DAYS = 30.4;

/** "12 days old" / "8 weeks old" / "3 months old" */
export function ageStr(birth: number, now: number): string {
  const days = Math.floor((now - birth) / 86400000);
  if (days < 14) return `${days} days old`;
  const w = Math.floor(days / 7);
  if (w < 14) return `${w} weeks old`;
  const mo = Math.floor(days / APPROX_MONTH_DAYS);
  return `${mo} months old`;
}

/** Whole months of age, matching ageStr's 30.4-day month. Floored, never negative. */
export function ageMonths(birth: number, now: number): number {
  return Math.max(0, Math.floor((now - birth) / 86400000 / APPROX_MONTH_DAYS));
}

/** Takes primitives rather than a Child so the Android widget, which cannot import store
 *  types, shares this logic. Never counts up past the due date. */
export function ageOrDueLabel(birth: number, expected: boolean, now: number): string {
  if (!expected) return ageStr(birth, now);
  const days = Math.ceil((birth - now) / 86400000);
  if (days <= 0) return 'Due any day now';
  if (days === 1) return 'Due tomorrow';
  if (days <= 14) return `Due in ${days} days`;
  return `Due in ${Math.round(days / 7)} weeks`;
}

/** Point-event sub-label: "Today, 12m ago" / "Yesterday" */
export function relDayLabel(ms: number, now: number): string {
  const d = new Date(ms);
  const nowD = new Date(now);
  if (d.toDateString() === nowD.toDateString()) return 'Today, ' + fmtAgo(ms, now);
  return 'Yesterday';
}

/** Stable identity for a LOCAL calendar day. Not the label, which is relative to `now`
 *  and so cannot key a selection that must survive the clock passing midnight. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * "Today" / "Yesterday" / DD/MM/YYYY (nl-BE). "Yesterday" is the previous CALENDAR day,
 * never a rolling 48-hour window, which at 01:00 would label a 29h-old entry the same as
 * one from yesterday evening.
 *
 * Three Date allocations and up to four `toDateString` calls, so call it once per day
 * GROUP, never once per item.
 */
export function dayGroupLabel(ms: number, now: number): string {
  const d = new Date(ms);
  const nowD = new Date(now);
  if (d.toDateString() === nowD.toDateString()) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/** Elapsed clock for live timers: "M:SS" or "H:MM:SS". */
export function fmtElapsedClock(fromMs: number, now: number): string {
  const secs = Math.max(0, Math.floor((now - fromMs) / 1000));
  const mm = Math.floor(secs / 60);
  const ss = secs % 60;
  const hh = Math.floor(mm / 60);
  return hh > 0
    ? `${hh}:${String(mm % 60).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${mm}:${String(ss).padStart(2, '0')}`;
}
