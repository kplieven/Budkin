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
  /** which "Ended" anchor set the end (for highlighting); cleared by a manual edit */
  endAnchor?: 'feedstart' | 'sleepstart' | 'diaper';
  /** end not set yet (in progress) — saved as a running timer */
  ongoing?: boolean;
  /** absolute start (ms), pinned via an anchor / edit / going-ongoing */
  startAbs?: number;
  /** which "Started" anchor set the start (for highlighting) */
  startAnchor?: 'lastfeed' | 'wake' | 'diaper' | 'now';
  /** start as "minutes ago" when set via a "Xm ago" chip (mirrors endAgoMin);
   *  resolved live so it stays that many minutes before now */
  startAgoMin?: number;
  /**
   * The user set the start THEMSELVES (a "Started" chip or the clock), as
   * opposed to it being derived from `end − lasted` or frozen by a nudge to the
   * other endpoint. Editing a logged entry leaves the start derived, so it
   * slides whenever the end or the duration moves; "Still ongoing" consults
   * this to decide whether the entry's own recorded start still stands.
   */
  startEdited?: boolean;
  /** duration in minutes (the "lasted" quantity) */
  durationMin?: number;

  // ---- point ----
  agoMin?: number;
  absTime?: number;
  /** which "When" anchor set the timestamp (for highlighting); cleared by a manual edit */
  pointAnchor?: 'lastfeed' | 'wake' | 'diaper';

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
  /** bath (point): which wash was given */
  wash?: 'small' | 'big';
  /** temperature (point): the numeric reading being entered (°C) */
  temperature?: number;
  /** medication (point): the medication name being entered (required to save) */
  medName?: string;
  /** medication (point): the amount given (paired with `medUnit`) */
  medDosage?: number;
  /** medication (point): the free-text dosage unit (e.g. "mg", "mL") */
  medUnit?: string;
  /** medication (point): next-dose interval in whole seconds, seeded from an
   *  interval cure so the saved dose carries Baby Buddy's `next_dose_interval` */
  medNextDoseIntervalSec?: number;
  /** note (point): the note BODY being edited — the primary free-text field of a
   *  general note. Distinct from `notes` (the secondary per-entry annotation). */
  noteText?: string;
  /** free-text notes (feeding/sleep/diaper/pumping/tummy/temperature — not bath/note) */
  notes?: string;

  tags: string[];
}
