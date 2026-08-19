/**
 * The home-screen widget's "today": the settings-driven `rhythmOriginHour` window,
 * derived at RENDER time from raw records carried in the snapshot.
 *
 * Render time and not snapshot-build time, because the widget draws to a frozen bitmap
 * and Android's refresh floor is `updatePeriodMillis` = 30 minutes, which does not wake
 * a sleeping device (in Doze it can be hours). A total baked in at snapshot-build time
 * goes categorically wrong the moment the day boundary passes, showing yesterday's
 * figures until something triggers a rebuild. The render path has a live clock, so
 * computing the window here makes the rollover self-correcting.
 *
 * The boundary split is not reimplemented: these are the same helpers Home and Insights
 * use, bucketing the way `buildTrend`/`buildDiaperSeries` do.
 */

import { DAY, liveSleepMsInWindow, windowStart } from '@/features/insights/compute';
import { fmtDur } from '@/lib/format';
import { clampHourOfDay, fmtDayStartHour, RHYTHM_ORIGIN_DEFAULT } from '@/store/selectors';
import type { Entry, Timer } from '@/types/models';

/**
 * 48h covers the widest window (24h) plus a sleep that started before it began, at any
 * origin hour, with a day of slack for a widget that has not refreshed in a while.
 */
export const WIDGET_LOOKBACK_MS = 2 * DAY;

type WidgetEntry = Extract<Entry, { type: 'sleep' | 'feeding' | 'diaper' }>;

function widgetRelevant(e: Entry): e is WidgetEntry {
  return e.type === 'sleep' || e.type === 'feeding' || e.type === 'diaper';
}

/**
 * Judged on the LATEST timestamp a record carries, so a long sleep that began before the
 * cutoff but ended inside it is kept whole and the boundary split can still cut it.
 *
 * Pass entries already scoped to the selected child; this does no child filtering.
 */
export function pruneWidgetEntries(entries: Entry[], now: number): Entry[] {
  const cutoff = now - WIDGET_LOOKBACK_MS;
  return entries.filter((e) => {
    if (!widgetRelevant(e)) return false;
    const last = e.type === 'diaper' ? e.time : (e.end ?? e.start);
    return last >= cutoff;
  });
}

/** `WidgetSnapshot` satisfies this structurally, so the widget passes it straight in. */
export interface WidgetTodaySource {
  /** pruned records for the selected child (see `pruneWidgetEntries`) */
  entries: Entry[];
  /** start of the running sleep timer, or null */
  sleepStart: number | null;
  /** the client-wide day boundary, hour of local day */
  rhythmOriginHour: number;
  /** selected child not born yet: there is no sleep to total, so show no figure */
  expected?: boolean;
}

export interface WidgetToday {
  /** start (ms) of the window `now` falls in */
  windowStartMs: number;
  /** sleep in the window, live nap included, in minutes */
  sleepMin: number;
  /** feeds STARTED in the window */
  feeds: number;
  /** diaper changes in the window */
  diapers: number;
  /** the Sleep row's value: always the window total, "—" only with no snapshot */
  sleepValue: string;
  /** the summary line, naming the boundary the counts are measured from */
  todayLine: string;
}

/**
 * The snapshot carries the running nap's START, not the whole `Timer`, so rebuild the
 * minimal shape `liveSleepMsInWindow` reads. That puts the live nap through the same
 * clamp as a completed sleep instead of a second inline one.
 */
function runningSleepTimers(sleepStart: number | null): Timer[] {
  if (sleepStart == null) return [];
  return [{ id: 'widget-running-sleep', activity: 'sleep', saveAs: 'sleep', name: 'Sleep', start: sleepStart }];
}

/**
 * A null source is the "no snapshot yet" case (widget added before the first app launch,
 * or the first run after the snapshot key was bumped): there is genuinely no data, so
 * the sleep value stays the placeholder rather than claiming a zero.
 */
export function widgetToday(s: WidgetTodaySource | null, now: number): WidgetToday {
  // One clamp for both the boundary and its label, so a junk persisted value cannot make
  // the number and the caption disagree.
  const originHour = clampHourOfDay(s?.rhythmOriginHour ?? RHYTHM_ORIGIN_DEFAULT, RHYTHM_ORIGIN_DEFAULT);
  const windowStartMs = windowStart(now, originHour);
  const entries = s?.entries ?? [];
  const napping = s?.sleepStart != null;
  const sleepMin = liveSleepMsInWindow(entries, runningSleepTimers(s?.sleepStart ?? null), windowStartMs, now) / 60000;
  // Re-derive each record's own window rather than comparing against `windowStartMs +
  // DAY`: `windowStart` rebuilds the boundary from calendar fields, so this stays right
  // on a DST day, where the window is 23 or 25 hours long.
  const inWindow = (ms: number) => windowStart(ms, originHour) === windowStartMs;
  const feeds = entries.filter((e) => e.type === 'feeding' && inWindow(e.start)).length;
  const diapers = entries.filter((e) => e.type === 'diaper' && inWindow(e.time)).length;
  // The boundary is user-configurable and is not midnight by default, so a literal
  // "Today" actively misleads.
  const since = `since ${fmtDayStartHour(originHour)}`;
  return {
    windowStartMs,
    sleepMin,
    feeds,
    diapers,
    // A real zero reads "0 min", per Home. Two cases are not a real zero and keep the
    // dash: no snapshot at all, and an unborn child.
    sleepValue: !s || s.expected ? '—' : napping ? `${fmtDur(sleepMin)} · napping` : fmtDur(sleepMin),
    todayLine: `${since} · ${feeds} feeds · ${diapers} changes`,
  };
}
