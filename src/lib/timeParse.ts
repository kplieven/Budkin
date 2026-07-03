/**
 * Parsing for the precise time editor (TimeAdjuster). Pure — `now` is always
 * passed explicitly.
 *
 * Clock input is 24-hour and digits-first (number-pad friendly): "9" → 09:00,
 * "14" → 14:00, "930" → 09:30, "1447" → 14:47, "2:47" → 02:47. 24h means there
 * is no AM/PM ambiguity to resolve — the typed value is the time.
 */

export interface ClockInput {
  h: number; // 0-23
  m: number; // 0-59
}

/** Parse raw 24h clock text. Returns null when it isn't a valid time. */
export function parseClockInput(text: string): ClockInput | null {
  const cleaned = text.trim().replace(/\s+/g, '');
  let h: number;
  let m: number;

  const colon = cleaned.match(/^(\d{1,2}):(\d{2})$/);
  if (colon) {
    h = Number(colon[1]);
    m = Number(colon[2]);
  } else if (/^\d{1,4}$/.test(cleaned)) {
    if (cleaned.length <= 2) {
      h = Number(cleaned); // "9" → 09:00, "14" → 14:00
      m = 0;
    } else {
      h = Number(cleaned.slice(0, -2)); // "930" → 09:30, "1447" → 14:47
      m = Number(cleaned.slice(-2));
    }
  } else {
    return null;
  }

  if (h > 23 || m > 59) return null;
  return { h, m };
}

/**
 * Resolve parsed clock input to an absolute timestamp on the day containing
 * `dayMs`. A logged time is never in the future: if the time on that day would
 * be after `now` (only possible on today), roll back to the previous day — so
 * typing "14:47" at 09:00 means 14:47 yesterday, its most recent occurrence,
 * rather than silently snapping to now.
 */
export function resolveClock(input: ClockInput, dayMs: number, now: number): number {
  const day = new Date(dayMs);
  let t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), input.h, input.m).getTime();
  if (t > now) t -= 86400000;
  return t;
}

/** Parse duration text: "37", "1:35", "1h35", "1h", "45m" → minutes (≥ 1). */
export function parseDurationInput(text: string): number | null {
  const cleaned = text.trim().toLowerCase().replace(/\s+/g, '');
  let min: number | null = null;

  const colon = cleaned.match(/^(\d{1,2}):(\d{2})$/);
  const hm = cleaned.match(/^(\d{1,2})h(\d{1,2})?m?$/);
  const mOnly = cleaned.match(/^(\d{1,4})m?$/);
  if (colon) {
    const mm = Number(colon[2]);
    if (mm > 59) return null;
    min = Number(colon[1]) * 60 + mm;
  } else if (hm) {
    const mm = hm[2] ? Number(hm[2]) : 0;
    if (mm > 59) return null;
    min = Number(hm[1]) * 60 + mm;
  } else if (mOnly) {
    min = Number(mOnly[1]);
  }

  return min != null && min >= 1 ? min : null;
}
