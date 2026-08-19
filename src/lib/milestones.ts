import { APPROX_MONTH_DAYS } from '@/lib/format';
import type { Entry, MilestoneEntry } from '@/types/models';

export type MilestoneCategory =
  | 'Movement'
  | 'Hands & play'
  | 'Communication'
  | 'Social & emotional'
  | 'Feeding & firsts';

export interface MilestoneDef {
  /** stable key; the mk:<key> tag */
  key: string;
  title: string;
  category: MilestoneCategory;
  /** typical age range in months, inclusive */
  minMonths: number;
  maxMonths: number;
}

export const MILESTONE_CATEGORIES: MilestoneCategory[] = [
  'Movement',
  'Hands & play',
  'Communication',
  'Social & emotional',
  'Feeding & firsts',
];

/** Age ranges are gentle typical windows, never a pass/fail bar. Order within a
 *  category is roughly developmental. */
export const MILESTONES: MilestoneDef[] = [
  { key: 'lifts-head', title: 'Lifts head', category: 'Movement', minMonths: 1, maxMonths: 3 },
  { key: 'rolls-over', title: 'Rolls over', category: 'Movement', minMonths: 4, maxMonths: 6 },
  { key: 'sits-unassisted', title: 'Sits unassisted', category: 'Movement', minMonths: 5, maxMonths: 8 },
  { key: 'crawls', title: 'Crawls', category: 'Movement', minMonths: 7, maxMonths: 10 },
  { key: 'pulls-to-stand', title: 'Pulls to stand', category: 'Movement', minMonths: 8, maxMonths: 11 },
  { key: 'cruises', title: 'Cruises furniture', category: 'Movement', minMonths: 9, maxMonths: 12 },
  { key: 'stands-alone', title: 'Stands alone', category: 'Movement', minMonths: 10, maxMonths: 14 },
  { key: 'first-steps', title: 'First steps', category: 'Movement', minMonths: 9, maxMonths: 15 },
  { key: 'grasps-toy', title: 'Grasps a toy', category: 'Hands & play', minMonths: 3, maxMonths: 5 },
  { key: 'passes-toy', title: 'Passes toy hand to hand', category: 'Hands & play', minMonths: 5, maxMonths: 7 },
  { key: 'pincer-grasp', title: 'Pincer grasp', category: 'Hands & play', minMonths: 8, maxMonths: 12 },
  { key: 'stacks-blocks', title: 'Stacks blocks', category: 'Hands & play', minMonths: 12, maxMonths: 18 },
  { key: 'coos', title: 'Coos', category: 'Communication', minMonths: 2, maxMonths: 4 },
  { key: 'first-laugh', title: 'First laugh', category: 'Communication', minMonths: 3, maxMonths: 5 },
  { key: 'babbles', title: 'Babbles', category: 'Communication', minMonths: 4, maxMonths: 7 },
  { key: 'responds-to-name', title: 'Responds to name', category: 'Communication', minMonths: 6, maxMonths: 9 },
  { key: 'waves-bye', title: 'Waves bye-bye', category: 'Communication', minMonths: 9, maxMonths: 12 },
  { key: 'first-word', title: 'First word', category: 'Communication', minMonths: 9, maxMonths: 14 },
  { key: 'points', title: 'Points at things', category: 'Communication', minMonths: 9, maxMonths: 14 },
  { key: 'first-smile', title: 'First smile', category: 'Social & emotional', minMonths: 1, maxMonths: 3 },
  { key: 'peekaboo', title: 'Enjoys peekaboo', category: 'Social & emotional', minMonths: 5, maxMonths: 9 },
  { key: 'stranger-awareness', title: 'Stranger awareness', category: 'Social & emotional', minMonths: 6, maxMonths: 10 },
  { key: 'shows-affection', title: 'Shows affection', category: 'Social & emotional', minMonths: 9, maxMonths: 15 },
  { key: 'first-solid', title: 'First solid food', category: 'Feeding & firsts', minMonths: 4, maxMonths: 6 },
  { key: 'first-tooth', title: 'First tooth', category: 'Feeding & firsts', minMonths: 4, maxMonths: 10 },
  { key: 'finger-feeds', title: 'Finger-feeds self', category: 'Feeding & firsts', minMonths: 8, maxMonths: 12 },
  { key: 'drinks-from-cup', title: 'Drinks from a cup', category: 'Feeding & firsts', minMonths: 9, maxMonths: 15 },
];

export const MILESTONE_BY_KEY: Record<string, MilestoneDef> = Object.fromEntries(
  MILESTONES.map((m) => [m.key, m]),
);

/** On the off chance of duplicates for one key, the earliest reached time wins. */
export function reachedByKey(entries: Entry[]): Map<string, MilestoneEntry> {
  const map = new Map<string, MilestoneEntry>();
  for (const e of entries) {
    if (e.type !== 'milestone') continue;
    const prev = map.get(e.key);
    if (!prev || e.time < prev.time) map.set(e.key, e);
  }
  return map;
}

/** Not-yet-reached milestones whose typical range spans the child's age in whole
 *  months, inclusive at both ends. */
export function aroundNow(ageMonths: number | null, reached: Map<string, MilestoneEntry>): MilestoneDef[] {
  if (ageMonths == null) return [];
  return MILESTONES.filter(
    (m) => !reached.has(m.key) && ageMonths >= m.minMonths && ageMonths <= m.maxMonths,
  );
}

/** `entries` holds every child's history in BOTH modes, so the childId filter is
 *  always load-bearing, never a no-op. */
export function reachedForChild(entries: Entry[], childId: string | undefined): Map<string, MilestoneEntry> {
  if (!childId) return new Map();
  return reachedByKey(entries.filter((e) => e.childId === childId));
}

/** Window fully passed, so age STRICTLY greater than maxMonths: that hands off
 *  cleanly from `aroundNow`, which covers minMonths..maxMonths inclusive. Sorted
 *  longest-overdue first. */
export function overdueUnlogged(
  ageMonths: number | null,
  reached: Map<string, MilestoneEntry>,
  answered: readonly string[],
): MilestoneDef[] {
  if (ageMonths == null) return [];
  return MILESTONES.filter(
    (m) => ageMonths > m.maxMonths && !reached.has(m.key) && !answered.includes(m.key),
  ).sort((a, b) => a.maxMonths - b.maxMonths);
}

/**
 * Scheduling reads this rather than adding calendar months, because `ageMonths` counts in
 * 30.4-day months. Four calendar months after a birth is 120 to 123 days, which
 * `ageMonths` still reports as 3 for the shorter spans, so a calendar-derived reminder
 * could arrive days before the home-screen nudge shows the same milestone.
 */
export function catchUpDueAt(birth: number, m: MilestoneDef): number {
  return birth + Math.ceil((m.maxMonths + 1) * APPROX_MONTH_DAYS * 86400000);
}

export function groupByCategory(defs: MilestoneDef[]): { category: MilestoneCategory; items: MilestoneDef[] }[] {
  return MILESTONE_CATEGORIES.map((category) => ({
    category,
    items: defs.filter((d) => d.category === category),
  })).filter((g) => g.items.length > 0);
}
