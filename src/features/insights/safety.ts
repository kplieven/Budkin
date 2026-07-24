import { entryTimestamp, type Entry } from '@/types/models';
import { DAY, dayStart } from './compute';

/**
 * The narrow, calm safety net. Two hydration/intake signals the literature
 * treats as genuinely worth a parent's attention: too few wet nappies, and (for
 * newborns) too few feeds. Everything here is tuned HARD against false alarms —
 * the evidence is that noisy alerts on normal variation increase anxiety and get
 * the tab abandoned, so a flag only fires when the signal is both real and
 * current:
 *
 *   - It needs a run of >= 2 consecutive below-floor days, not a single dip.
 *   - Days that look under-logged are skipped, so "no wet nappy logged" is never
 *     mistaken for "no wet nappy happened" (the classic parent-data caveat). A
 *     day counts only if its total logging volume is at least half that family's
 *     own recent median — this adapts to light vs heavy loggers.
 *   - The run must reach the most recent reliably-logged day (the situation is
 *     ongoing), so a dip that already recovered doesn't nag.
 *   - Thresholds are age-gated: the wet floor applies once the newborn ramp is
 *     past, the feed floor only in the newborn window and after the first week.
 *
 * This is intentionally NOT medical advice and NOT an alarm; the UI renders it
 * as a gentle "worth a word with your doctor" note, never red.
 */

const LOOKBACK_DAYS = 10;
const WET_FLOOR = 6;            // NHS: "6 or more wet nappies a day" from ~day 5
const WET_MIN_AGE_DAYS = 5;     // before this the count is still ramping up
const FEEDS_FLOOR = 6;          // well under the newborn 8–12/24h → worth a mention
const FEEDS_MIN_AGE_DAYS = 7;   // "after the first week"
const FEEDS_MAX_AGE_DAYS = 120; // a newborn-window concern only
const MIN_RELIABLE_DAYS = 3;    // need enough well-logged history to trust a run
const MIN_RUN = 2;              // never flag on a single day

export type SafetyKind = 'wetLow' | 'feedsLow';

export interface SafetyFlag {
  kind: SafetyKind;
  /** length of the current consecutive below-floor run (>= MIN_RUN) */
  days: number;
  /** the age-appropriate floor the count fell under */
  floor: number;
  /** the most recent reliably-logged day's count of that event */
  latest: number;
}

interface DayTally { day: number; wet: number; feeds: number; total: number }

export function detectSafetyFlags(entries: Entry[], birthMs: number, now: number): SafetyFlag[] {
  const cutoff = dayStart(now) - (LOOKBACK_DAYS - 1) * DAY;
  const byDay = new Map<number, DayTally>();
  for (const e of entries) {
    const ts = entryTimestamp(e);
    if (ts < cutoff) continue;
    const day = dayStart(ts);
    let d = byDay.get(day);
    if (!d) { d = { day, wet: 0, feeds: 0, total: 0 }; byDay.set(day, d); }
    d.total += 1;
    if (e.type === 'diaper' && e.wet) d.wet += 1;
    if (e.type === 'feeding') d.feeds += 1;
  }

  const days = [...byDay.values()].sort((a, b) => a.day - b.day);
  if (!days.length) return [];

  // A day is trustworthy for a low-count check only if it was logged about as
  // thoroughly as this family usually logs. Half the recent median (min 3).
  const totals = days.map((d) => d.total).sort((a, b) => a - b);
  const median = totals[Math.floor(totals.length / 2)];
  const reliableThreshold = Math.max(3, median * 0.5);
  const reliable = days.filter((d) => d.total >= reliableThreshold);
  if (reliable.length < MIN_RELIABLE_DAYS) return [];

  const latest = reliable[reliable.length - 1];
  const latestAge = (latest.day - birthMs) / DAY;

  // Trailing run of consecutive reliably-logged days for which `below` holds.
  const trailingRun = (below: (d: DayTally) => boolean): number => {
    let n = 0;
    for (let i = reliable.length - 1; i >= 0; i--) {
      if (below(reliable[i])) n += 1;
      else break;
    }
    return n;
  };

  const flags: SafetyFlag[] = [];
  if (latestAge >= WET_MIN_AGE_DAYS) {
    const run = trailingRun((d) => d.wet < WET_FLOOR);
    if (run >= MIN_RUN) flags.push({ kind: 'wetLow', days: run, floor: WET_FLOOR, latest: latest.wet });
  }
  if (latestAge >= FEEDS_MIN_AGE_DAYS && latestAge <= FEEDS_MAX_AGE_DAYS) {
    const run = trailingRun((d) => d.feeds < FEEDS_FLOOR);
    if (run >= MIN_RUN) flags.push({ kind: 'feedsLow', days: run, floor: FEEDS_FLOOR, latest: latest.feeds });
  }
  return flags;
}
