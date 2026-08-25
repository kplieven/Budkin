/**
 * Working model for the reusable Time-Entry component.
 *
 * The interval shape (feeding/sleep/pumping/tummy) has three quantities but only two are
 * ever active: the last two the user picked, with the third derived. `order` is the
 * recency list, most-recent first, so `order[2]` is the derived one. The point shape
 * (diaper) is a single timestamp via `agoMin`/`absTime`.
 */

import type { WashKind } from '@/lib/wash';

import type { DiaperColor, FeedMethod, FeedType } from './models';

export type TimeEntryShape = 'interval' | 'point';

export type TimeField = 'start' | 'end' | 'lasted';

export interface TimeEntryState {
  shape: TimeEntryShape;

  // interval
  /** recency order, most-recent first; order[2] is the derived quantity */
  order?: TimeField[];
  /** end as "minutes ago" (0 = now) when set relatively */
  endAgoMin?: number;
  /** absolute end (ms), set when editing or via the precise editor */
  endAbs?: number;
  /** which "Ended" anchor set the end (for highlighting); cleared by a manual edit */
  endAnchor?: 'feedstart' | 'sleepstart' | 'diaper';
  /** end not set yet (in progress), saved as a running timer */
  ongoing?: boolean;
  /** absolute start (ms), pinned via an anchor / edit / going-ongoing */
  startAbs?: number;
  /** which "Started" anchor set the start (for highlighting) */
  startAnchor?: 'lastfeed' | 'wake' | 'diaper' | 'now';
  /** start as "minutes ago", resolved live so it stays that many minutes before now */
  startAgoMin?: number;
  /** The user set the start themselves, rather than it being derived from `end - lasted`.
   *  Editing a logged entry leaves it derived, so it slides whenever the end or the
   *  duration moves, and "Still ongoing" consults this to decide whether the entry's own
   *  recorded start still stands. */
  startEdited?: boolean;
  /** duration in minutes (the "lasted" quantity) */
  durationMin?: number;

  // point
  agoMin?: number;
  absTime?: number;
  /** which "When" anchor set the timestamp (for highlighting); cleared by a manual edit */
  pointAnchor?: 'lastfeed' | 'wake' | 'diaper';

  // activity fields
  feedType?: FeedType;
  method?: FeedMethod;
  /** for breastfeeding "both": which side she started on (saved as a left/right tag) */
  startSide?: 'left' | 'right';
  /**
   * The user picked this value themselves, rather than taking the suggestion the sheet
   * seeded from the child's own history. All three are child-scoped, so re-aiming at a
   * sibling re-seeds them, and these keep that recompute from overruling a decision
   * already made. One flag per field, not one for the group: touching the feed type must
   * not freeze the method and the side on the previous child's history.
   */
  feedTypeEdited?: boolean;
  methodEdited?: boolean;
  startSideEdited?: boolean;
  amount?: number;
  wet?: boolean;
  solid?: boolean;
  color?: DiaperColor;
  nap?: boolean;
  milestone?: string;
  /** bath (point): which wash was given */
  wash?: WashKind;
  /** As `feedTypeEdited`, for the wash. */
  washEdited?: boolean;
  /** °C */
  temperature?: number;
  /** required to save a medication */
  medName?: string;
  medDosage?: number;
  /** free text, e.g. "mg", "mL" */
  medUnit?: string;
  /** whole seconds, seeded from an interval treatment so the saved dose carries Baby
   *  Buddy's `next_dose_interval` */
  medNextDoseIntervalSec?: number;
  /** UI-only, seeded from a sporadic treatment still in its cooldown; never saved onto
   *  the entry. Empty when there's nothing to warn about. */
  medCooldownWarning?: string;
  /** the note BODY, distinct from `notes`, the secondary per-entry annotation */
  noteText?: string;
  /** free-text notes (feeding/sleep/diaper/pumping/tummy/temperature, not bath/note) */
  notes?: string;

  tags: string[];
}
