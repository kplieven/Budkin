/**
 * Demo seed data, ported from the design handoff reference. Used in demo mode
 * (no server) so the app is fully explorable. Timestamps are relative to `now`.
 */

import type { Child, Entry, FeedMethod, FeedType, Measurement, Tag, Timer } from '@/types/models';

const M = 60000;
const DAY = 86400000;

/**
 * Demo-mode fallback tag list (no server to read `/api/tags/`). Keeps the old
 * hardcoded picker defaults so the tag picker isn't empty in demo mode. No
 * colors — demo chips render without a swatch, which is fine.
 */
export const DEMO_TAGS: Tag[] = ['Left side', 'Cluster', 'Spit-up', 'Fussy', 'Sleepy'].map((name) => ({
  name,
}));

export interface SeedData {
  children: Child[];
  entries: Entry[];
  timers: Timer[];
  selectedChildId: string;
  lastFeed: { feedType: FeedType; method: FeedMethod };
  measurements: Measurement[];
}

export function makeSeed(now: number): SeedData {
  const c1 = 'c1';
  return {
    selectedChildId: c1,
    lastFeed: { feedType: 'breast', method: 'left' },
    children: [
      { id: 'c1', first: 'Mira', last: 'Okafor', birth: now - 86 * DAY, color: '#EBA06A' },
      { id: 'c2', first: 'Theo', last: 'Okafor', birth: now - 86 * DAY, color: '#9F94D4' },
    ],
    timers: [{ id: 't1', activity: 'sleep', name: 'Sleep', start: now - 27 * M, saveAs: 'sleep' }],
    entries: [
      { id: 'e1', childId: c1, type: 'feeding', start: now - 96 * M, end: now - 78 * M, feedType: 'breast', method: 'right', amount: null, tags: [] },
      { id: 'e2', childId: c1, type: 'diaper', time: now - 41 * M, wet: true, solid: false, color: null, tags: [] },
      { id: 'e3', childId: c1, type: 'pumping', start: now - 150 * M, end: now - 133 * M, amount: 90, tags: [] },
      { id: 'e4', childId: c1, type: 'feeding', start: now - 235 * M, end: now - 220 * M, feedType: 'formula', method: 'bottle', amount: 120, tags: [] },
      { id: 'e5', childId: c1, type: 'sleep', start: now - 300 * M, end: now - 182 * M, nap: true, tags: [] },
      { id: 'e6', childId: c1, type: 'diaper', time: now - 250 * M, wet: true, solid: true, color: 'yellow', tags: [] },
      { id: 'e7', childId: c1, type: 'tummy', start: now - 330 * M, end: now - 322 * M, milestone: 'Lifted head', tags: [] },
      // A bath rhythm mid-cycle: a full bath four days ago, then three quick
      // washes, so a full bath reads as due today at the default rhythm of
      // every three days.
      { id: 'e8', childId: c1, type: 'bath', time: now - 4 * DAY, wash: 'full', tags: [] },
      { id: 'e9', childId: c1, type: 'bath', time: now - 3 * DAY, wash: 'quick', tags: [] },
      { id: 'e10', childId: c1, type: 'bath', time: now - 2 * DAY, wash: 'quick', tags: [] },
      { id: 'e11', childId: c1, type: 'bath', time: now - 1 * DAY, wash: 'quick', tags: [] },
      // A normal reading yesterday and a slightly warm one a few hours ago.
      { id: 'e12', childId: c1, type: 'temperature', time: now - 26 * 60 * M, value: 36.9, tags: [] },
      { id: 'e13', childId: c1, type: 'temperature', time: now - 5 * 60 * M, value: 37.8, notes: 'a little warm after her nap', tags: [] },
      // A dose given after the warm reading, plus the daily vitamin.
      { id: 'e16', childId: c1, type: 'medication', time: now - 4 * 60 * M, name: 'Paracetamol', dosage: 2.5, dosageUnit: 'mL', notes: 'for the low fever', tags: [] },
      { id: 'e17', childId: c1, type: 'medication', time: now - 12 * 60 * M, name: 'Vitamin D', dosage: 400, dosageUnit: 'IU', tags: [] },
      // General notes (plain — NO bath tag) live in the dedicated Notes tab.
      { id: 'e14', childId: c1, type: 'note', time: now - 9 * 60 * M, text: 'Pediatrician follow-up booked for next Tuesday at 10am.', tags: [] },
      { id: 'e15', childId: c1, type: 'note', time: now - 30 * 60 * M, text: 'First real giggle today when we played peekaboo — melted us.', tags: ['Milestone'] },
    ],
    measurements: [
      { id: 'm1', childId: c1, kind: 'weight', value: 5.2, date: now - 2 * DAY },
      { id: 'm2', childId: c1, kind: 'height', value: 58, date: now - 10 * DAY },
      { id: 'm3', childId: c1, kind: 'head', value: 39, date: now - 10 * DAY },
      { id: 'm4', childId: c1, kind: 'bmi', value: 15.4, date: now - 2 * DAY },
    ],
  };
}
