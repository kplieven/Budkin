/**
 * Working model for the reusable Time-Entry component.
 *
 * INTERVAL shape (feeding/sleep/pumping/tummy) has three quantities —
 * start, end, lasted (duration) — but only TWO are ever "active". The user
 * picks values and we keep the **last two selected**; the third is derived.
 * `order` is the recency list (most-recent first); `order[2]` is the derived
 * one. Each quantity can also be pinned to a precise value by tapping its
 * resolved readout (start/end → absolute ms, lasted → exact minutes).
 *
 * POINT shape (diaper) is a single timestamp via `agoMin`/`absTime`.
 */

import type { DiaperColor, FeedMethod, FeedType } from './models';

export type TimeEntryShape = 'interval' | 'point';

export type TimeField = 'start' | 'end' | 'lasted';

export interface TimeEntryState {
  shape: TimeEntryShape;

  // ---- interval ----
  /** recency order, most-recent first; order[2] is the derived quantity */
  order?: TimeField[];
  /** end as "minutes ago" (0 = now) when set relatively */
  endAgoMin?: number;
  /** absolute end (ms), set when editing or via the precise editor */
  endAbs?: number;
  /** end not set yet (in progress) — saved as a running timer */
  ongoing?: boolean;
  /** absolute start (ms), pinned via an anchor / edit / going-ongoing */
  startAbs?: number;
  /** which "Started" anchor set the start (for highlighting) */
  startAnchor?: 'lastfeed' | 'wake' | 'now';
  /** duration in minutes (the "lasted" quantity) */
  durationMin?: number;

  // ---- point ----
  agoMin?: number;
  absTime?: number;

  // ---- activity fields ----
  feedType?: FeedType;
  method?: FeedMethod;
  /** for breastfeeding "both": which side she started on (saved as a left/right tag) */
  startSide?: 'left' | 'right';
  amount?: number;
  wet?: boolean;
  solid?: boolean;
  color?: DiaperColor;
  nap?: boolean;
  milestone?: string;

  tags: string[];
}
