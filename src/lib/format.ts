/**
 * Time / duration formatters, ported verbatim from the design handoff reference.
 * All "now"-relative helpers take `now` (ms) explicitly so they stay pure.
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

/** Compact form for stat values and anchors: "5m" / "1h18m" */
export function fmtAgoShort(min: number): string {
  if (min < 60) return `${min}m`;
  if (min < 1440) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h}h${m}m` : `${h}h`;
  }
  return `${Math.floor(min / 1440)}d`;
}

/** "12 days old" / "8 weeks old" / "3 months old" */
export function ageStr(birth: number, now: number): string {
  const days = Math.floor((now - birth) / 86400000);
  if (days < 14) return `${days} days old`;
  const w = Math.floor(days / 7);
  if (w < 14) return `${w} weeks old`;
  const mo = Math.floor(days / 30.4);
  return `${mo} months old`;
}

/** Point-event sub-label: "Today, 12m ago" / "Yesterday" */
export function relDayLabel(ms: number, now: number): string {
  const d = new Date(ms);
  const nowD = new Date(now);
  if (d.toDateString() === nowD.toDateString()) return 'Today, ' + fmtAgo(ms, now);
  return 'Yesterday';
}

/** Day-group label for the timeline: "Today" / "Yesterday" / DD/MM/YYYY (nl-BE). */
export function dayGroupLabel(ms: number, now: number): string {
  const d = new Date(ms);
  const nowD = new Date(now);
  if (d.toDateString() === nowD.toDateString()) return 'Today';
  if (now - ms < 2 * 86400000) return 'Yesterday';
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
