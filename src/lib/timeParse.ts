/**
 * Parsing for the precise time editor (TimeAdjuster). Pure — `now` is always
 * passed explicitly.
 *
 * Clock input is digits-first (number-pad friendly): "9" → 9:00, "93"/"930" →
 * 9:30, "1447" → 14:47, "2:47" → 2:47, with an optional trailing a/am/p/pm.
 * Ambiguous 12-hour input is resolved with the *most-recent-match* rule so the
 * user never has to type AM/PM: among the candidate instants on the chosen
 * day, pick the latest one that isn't in the future.
 */

export interface ClockInput {
  h: number; // 0-23 as typed (12h input keeps its literal hour, 1-12)
  m: number;
  /** set when the user typed an explicit am/pm suffix */
  explicit12?: 'am' | 'pm';
}

/** Parse raw clock text. Returns null when the text isn't a valid time. */
export function parseClockInput(text: string): ClockInput | null {
  const cleaned = text.trim().toLowerCase().replace(/\s+/g, '');
  const sufMatch = cleaned.match(/(am?|pm?)$/);
  const explicit12 = sufMatch ? (sufMatch[1].startsWith('a') ? 'am' : 'pm') : undefined;
  const body = sufMatch ? cleaned.slice(0, -sufMatch[1].length) : cleaned;

  let h: number;
  let m: number;
  const colon = body.match(/^(\d{1,2}):(\d{2})$/);
  if (colon) {
    h = Number(colon[1]);
    m = Number(colon[2]);
  } else if (/^\d{1,4}$/.test(body)) {
    if (body.length <= 2) {
      // "9" → 9:00; "93" → 9:30 (single hour digit + tens of minutes)
      const n = Number(body);
      if (n <= 23) {
        h = n;
        m = 0;
      } else {
        h = Number(body[0]);
        m = Number(body[1]) * 10;
      }
    } else {
      // "930" → 9:30, "1447" → 14:47
      h = Number(body.slice(0, -2));
      m = Number(body.slice(-2));
    }
  } else {
    return null;
  }

  if (h > 23 || m > 59) return null;
  if (explicit12 && (h < 1 || h > 12)) return null;
  return { h, m, explicit12 };
}

/**
 * Resolve parsed clock input to an absolute timestamp on the day containing
 * `dayMs`, using the most-recent-match rule:
 * - explicit am/pm → that exact time (clamped to `now` if it'd be future);
 * - ambiguous h ≤ 12 → the latest of h / h+12 on that day that is ≤ `now`
 *   (for past days both qualify, so the PM reading wins);
 * - all candidates in the future (today) → clamp to `now`.
 */
export function resolveClock(input: ClockInput, dayMs: number, now: number): number {
  const day = new Date(dayMs);
  const at = (h: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, input.m).getTime();

  let candidates: number[];
  if (input.explicit12) {
    let h = input.h % 12;
    if (input.explicit12 === 'pm') h += 12;
    candidates = [at(h)];
  } else if (input.h >= 1 && input.h <= 12) {
    const h24: number[] = input.h === 12 ? [0, 12] : [input.h, input.h + 12];
    candidates = h24.map(at);
  } else {
    candidates = [at(input.h)];
  }

  const past = candidates.filter((t) => t <= now);
  if (past.length > 0) return Math.max(...past);
  return Math.min(now, Math.min(...candidates));
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
