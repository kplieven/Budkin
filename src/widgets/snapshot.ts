/**
 * Small cross-platform data snapshot the home-screen widget renders from.
 * The widget runs headless (no app state), so the app writes this snapshot to
 * AsyncStorage on every data change and the widget task handler reads it back.
 * Timestamps are absolute (ms) so the widget can compute "x ago" at render time.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { entriesForChild, lastDiaper, nextStartSide, runningTimer } from '@/store/selectors';
import { pruneWidgetEntries } from '@/widgets/today';
import type { Connection } from '@/data/repository';
import type { Child, Entry, Timer } from '@/types/models';

export interface WidgetSnapshot {
  childName: string;
  birth: number | null;
  expected: boolean;
  /** start of the most recent completed feeding — the widget shows "x ago" from feed start */
  lastFeedStart: number | null;
  nextSide: 'left' | 'right';
  lastDiaper: number | null;
  lastDiaperSolid: boolean;
  /** start of a running sleep timer, or null */
  sleepStart: number | null;
  /**
   * RAW records for the selected child, pruned to the widget's 48h lookback and
   * to the three types it reads (see `pruneWidgetEntries`). Deliberately raw and
   * not pre-summed totals: the widget's bitmap is frozen and Android's refresh
   * floor is 30 minutes, so a baked-in "today" total goes from stale to plain
   * wrong the moment the day boundary passes. The render path has a live clock,
   * so it windows these itself (`widgetToday`) and the rollover self-corrects.
   */
  entries: Entry[];
  /** the client-wide day boundary from Settings, so the widget windows like Home */
  rhythmOriginHour: number;
  /** id of the selected child — stamps entries created from the widget */
  selectedChildId: string;
  /** true when a real (non-demo) connection exists, so a widget-saved nap can be queued */
  canQueueNap: boolean;
  /**
   * How many children the device holds, so a widget can tell whether naming the
   * child says anything (see `napLabels`). Optional, and read with a `?? 1`
   * default: unlike the v1 change below this one reinterprets nothing, so a
   * stale v2 payload written before the field existed stays readable and
   * degrades to "one child, do not name anyone", which is the safe direction.
   * That is why the key stays v2.
   */
  childCount?: number;
}

/**
 * v2: the shape changed from pre-baked totals to raw records plus the day
 * boundary. A persisted v1 payload must never be read as a v2 one, and there is
 * deliberately no dual-path reader keeping the old fields as a fallback: two
 * permanent code paths is worse than one stale render. Until the app next runs
 * and writes v2, the widget shows the empty state `StatusWidget` already handles.
 */
const KEY = 'budkin.widget.v2';

export async function writeWidgetSnapshot(s: WidgetSnapshot): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export async function readWidgetSnapshot(): Promise<WidgetSnapshot | null> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v ? (JSON.parse(v) as WidgetSnapshot) : null;
  } catch {
    return null;
  }
}

/**
 * Takes a structural subset of the store state, so `sync.ts` can keep passing the
 * whole state object. `now` is used ONLY to anchor the record prune: no "today"
 * figure is computed here, by design (see `entries` above).
 */
export function buildWidgetSnapshot(s: {
  children: Child[];
  selectedChildId: string;
  entries: Entry[];
  timers: Timer[];
  connection: Connection | null;
  rhythmOriginHour: number;
  now: number;
}): WidgetSnapshot {
  const child = s.children.find((c) => c.id === s.selectedChildId);
  // `entries` holds every child's records, so scope to the selected child before
  // deriving any stat. Without this the widget shows a sibling's last feed and
  // diaper, which is wrong for any switched-to child and nonsense for an
  // expecting one (it owns no activity at all).
  const entries = entriesForChild(s.entries, s.selectedChildId);
  const lastFeeding = entries
    .filter((e): e is Extract<Entry, { type: 'feeding' }> => e.type === 'feeding' && e.end != null)
    .sort((a, b) => b.start - a.start)[0];
  const diaper = lastDiaper(entries);
  // The shared timer rule, keyed on `saveAs` (what the timer will be written as,
  // so a quick timer repointed to sleep counts) and scoped to the selected child
  // (so a sibling's nap does not show up as this child's). The selected child is
  // passed as both ids: an ownerless timer is the selected child's, and nobody
  // else's. `napToggle` MUST look the running nap up the same way, or a tap on a
  // widget showing "napping" would start a second timer.
  const runningSleep = runningTimer(s.timers, 'sleep', s.selectedChildId, s.selectedChildId);

  return {
    childName: child ? child.first : '',
    birth: child?.birth ?? null,
    expected: !!child?.expected,
    lastFeedStart: lastFeeding?.start ?? null,
    nextSide: nextStartSide(entries),
    lastDiaper: diaper?.time ?? null,
    lastDiaperSolid: diaper?.solid ?? false,
    sleepStart: runningSleep?.start ?? null,
    entries: pruneWidgetEntries(entries, s.now),
    rhythmOriginHour: s.rhythmOriginHour,
    selectedChildId: s.selectedChildId,
    canQueueNap: s.connection?.mode === 'server',
    childCount: s.children.length,
  };
}
