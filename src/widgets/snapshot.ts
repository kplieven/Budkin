/**
 * The data snapshot the home-screen widget renders from. The widget runs headless, so the
 * app writes this to AsyncStorage on every data change and the widget task handler reads
 * it back. Timestamps are absolute so the widget can compute "x ago" at render time.
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
  /** start of the most recent completed feeding; the widget shows "x ago" from it */
  lastFeedStart: number | null;
  nextSide: 'left' | 'right';
  lastDiaper: number | null;
  lastDiaperSolid: boolean;
  /** start of a running sleep timer, or null */
  sleepStart: number | null;
  /**
   * RAW records for the selected child, pruned to the widget's 48h lookback and to the
   * three types it reads. Raw rather than pre-summed totals: the bitmap is frozen and
   * Android's refresh floor is 30 minutes, so a baked-in "today" total goes plain wrong
   * the moment the day boundary passes. The render path windows these itself.
   */
  entries: Entry[];
  /** the client-wide day boundary from Settings, so the widget windows like Home */
  rhythmOriginHour: number;
  /** id of the selected child; stamps entries created from the widget */
  selectedChildId: string;
  /** true when a real (non-demo) connection exists, so a widget-saved nap can be queued */
  canQueueNap: boolean;
  /**
   * Lets a widget tell whether naming the child says anything. Optional and read with a
   * `?? 1` default: it reinterprets nothing, so a payload written before the field
   * existed stays readable and degrades to "one child, name nobody". Hence still v2.
   */
  childCount?: number;
}

/**
 * v2: the shape changed from pre-baked totals to raw records plus the day boundary, and a
 * persisted v1 payload must never be read as a v2 one. No dual-path reader keeping the
 * old fields as a fallback: until the app next writes v2 the widget shows the empty state
 * it already handles, which beats two permanent code paths.
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
 * A structural subset of the store state, so `sync.ts` can keep passing the whole state
 * object. `now` anchors the record prune only: no "today" figure is computed here.
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
  // `entries` holds every child's records, so scope before deriving any stat or the
  // widget shows a sibling's last feed and diaper.
  const entries = entriesForChild(s.entries, s.selectedChildId);
  const lastFeeding = entries
    .filter((e): e is Extract<Entry, { type: 'feeding' }> => e.type === 'feeding' && e.end != null)
    .sort((a, b) => b.start - a.start)[0];
  const diaper = lastDiaper(entries);
  // Keyed on `saveAs`, so a quick timer repointed to sleep counts. `napToggle` MUST look
  // the running nap up the same way, or a tap on a widget showing "napping" starts a
  // second timer.
  const runningSleep = runningTimer(s.timers, 'sleep', s.selectedChildId);

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
