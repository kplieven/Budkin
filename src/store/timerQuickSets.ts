/**
 * The Quick set chips on a running timer's card: every one names an absolute instant to
 * move the timer's start to. Lives beside `selectors` rather than in `lib` because it
 * reads the same anchor helpers, and pure so the ordering and absence rules are testable
 * without a store.
 */

import { ANCHOR_LABEL, anchorLabel, fmtAgoShort } from '@/lib/format';
import { entriesForChild, lastDiaperMinAgo, lastFeedEndMinAgo, lastWakeMinAgo } from '@/store/selectors';
import type { Entry } from '@/types/models';

const MIN = 60000;

export interface QuickSet {
  key: string;
  label: string;
  /** epoch ms the timer's start becomes */
  at: number;
  /** spoken instead of `label` where the visible text abbreviates ("1h ago") */
  spoken?: string;
}

/** Three fixed fallbacks, always present: they are the chips a household with no logged
 *  history still needs, and the only reach past the card's ±15m nudges. */
const FIXED: { key: string; min: number; spoken: string }[] = [
  { key: 'ago30', min: 30, spoken: 'Start 30 minutes ago' },
  { key: 'ago60', min: 60, spoken: 'Start 1 hour ago' },
  { key: 'ago120', min: 120, spoken: 'Start 2 hours ago' },
];

/**
 * `childId` is the TIMER's own child, never the selected one: a sibling's timer stays on
 * this screen, and anchoring it to the selected child's feeds would write a wrong start as
 * fact. Undefined (an unattributed timer) yields the fixed chips alone.
 */
export function timerQuickSets(entries: Entry[], childId: string | undefined, now: number): QuickSet[] {
  const mine = entriesForChild(entries, childId);
  const anchors: { key: string; base: string; min: number | null }[] = [
    { key: 'lastfeed', base: ANCHOR_LABEL.feedEnded, min: lastFeedEndMinAgo(mine, now) },
    { key: 'wake', base: ANCHOR_LABEL.woke, min: lastWakeMinAgo(mine, now) },
    { key: 'diaper', base: ANCHOR_LABEL.diaper, min: lastDiaperMinAgo(mine, now) },
  ];

  return [
    { key: 'now', label: 'Now', at: now },
    // Anchors sit directly after Now so the contextual chips — the ones that are only
    // sometimes there — are the ones visible before the strip has to be scrolled.
    ...anchors
      .filter((a): a is typeof a & { min: number } => a.min != null)
      .map((a) => ({ key: a.key, label: anchorLabel(a.base, a.min), at: now - a.min * MIN })),
    ...FIXED.map((f) => ({ key: f.key, label: `${fmtAgoShort(f.min)} ago`, at: now - f.min * MIN, spoken: f.spoken })),
  ];
}
