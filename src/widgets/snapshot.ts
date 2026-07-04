/**
 * Small cross-platform data snapshot the home-screen widget renders from.
 * The widget runs headless (no app state), so the app writes this snapshot to
 * AsyncStorage on every data change and the widget task handler reads it back.
 * Timestamps are absolute (ms) so the widget can compute "x ago" at render time.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { lastDiaper, nextStartSide } from '@/store/selectors';
import type { Connection } from '@/data/repository';
import type { Child, Entry, Timer } from '@/types/models';

export interface WidgetSnapshot {
  childName: string;
  birth: number | null;
  lastFeedEnd: number | null;
  nextSide: 'left' | 'right';
  lastDiaper: number | null;
  lastDiaperSolid: boolean;
  /** start of a running sleep timer, or null */
  sleepStart: number | null;
  /** total sleep minutes today (used when not currently napping) */
  sleepTodayMin: number;
  feedsToday: number;
  diapersToday: number;
  /** id of the selected child — stamps entries created from the widget */
  selectedChildId: string;
  /** true when a real (non-demo) connection exists, so a widget-saved nap can be queued */
  canQueueNap: boolean;
}

const KEY = 'babybuddy.widget.v1';

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

export function buildWidgetSnapshot(s: {
  children: Child[];
  selectedChildId: string;
  entries: Entry[];
  timers: Timer[];
  connection: Connection | null;
}): WidgetSnapshot {
  const child = s.children.find((c) => c.id === s.selectedChildId);
  const lastFeeding = s.entries
    .filter((e): e is Extract<Entry, { type: 'feeding' }> => e.type === 'feeding' && e.end != null)
    .sort((a, b) => (b.end as number) - (a.end as number))[0];
  const todayStr = new Date().toDateString();
  const sleepTodayMin = s.entries
    .filter((e): e is Extract<Entry, { type: 'sleep' }> => e.type === 'sleep' && e.end != null)
    .filter((e) => new Date(e.end as number).toDateString() === todayStr)
    .reduce((sum, e) => sum + ((e.end as number) - e.start) / 60000, 0);
  const diaper = lastDiaper(s.entries);
  const runningSleep = s.timers.find((t) => t.activity === 'sleep');
  const feedsToday = s.entries.filter(
    (e) => e.type === 'feeding' && new Date(e.end ?? e.start).toDateString() === todayStr,
  ).length;
  const diapersToday = s.entries.filter(
    (e) => e.type === 'diaper' && new Date(e.time).toDateString() === todayStr,
  ).length;

  return {
    childName: child ? child.first : '',
    birth: child?.birth ?? null,
    lastFeedEnd: lastFeeding?.end ?? null,
    nextSide: nextStartSide(s.entries),
    lastDiaper: diaper?.time ?? null,
    lastDiaperSolid: diaper?.solid ?? false,
    sleepStart: runningSleep?.start ?? null,
    sleepTodayMin: Math.round(sleepTodayMin),
    feedsToday,
    diapersToday,
    selectedChildId: s.selectedChildId,
    canQueueNap: !!s.connection && !s.connection.demo,
  };
}
