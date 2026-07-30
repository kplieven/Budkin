/**
 * The home-screen widget's "today": the settings-driven `rhythmOriginHour`
 * window, derived at RENDER time from raw records carried in the snapshot.
 *
 * Why render time and not snapshot-build time. The widget draws to a frozen
 * bitmap (RemoteViews gets an ImageView, not a live view tree) and Android's
 * refresh floor is `updatePeriodMillis` = 30 minutes (app.json), which does not
 * wake a sleeping device, so in Doze it can be hours. A total baked in when the
 * app last wrote the snapshot is therefore not merely late: from the moment the
 * day boundary passes it is categorically wrong, showing yesterday's figures
 * until something happens to trigger a rebuild. The render path does have a live
 * clock (`widgetTaskHandler` computes `Date.now()` and threads it in), so
 * computing the window here makes the boundary rollover self-correcting on the
 * next refresh, with no app run required.
 *
 * Why a pure `.ts` module and not inline in `StatusWidget.tsx`. vitest only
 * collects `src/**\/*.test.ts` and there is no React test renderer installed, so
 * nothing inside a `.tsx` widget component can be unit-tested. This file is the
 * only place the widget's arithmetic can be held to a test, which is why the
 * strings live here too and `StatusWidget` stays a presentational shell.
 *
 * The boundary split is NOT reimplemented here. `windowStart` and
 * `liveSleepMsInWindow` are the same helpers Home (`DashboardContent`) and the
 * Insights tab use, and the counts bucket the way `buildTrend`/`buildDiaperSeries`
 * do (feeds by `start`, diapers by `time`), so the widget cannot disagree with
 * the app about what "today" holds.
 */

import { DAY, liveSleepMsInWindow, windowStart } from '@/features/insights/compute';
import { fmtDur } from '@/lib/format';
import { clampHourOfDay, fmtDayStartHour, RHYTHM_ORIGIN_DEFAULT } from '@/store/selectors';
import type { Entry, Timer } from '@/types/models';

/**
 * How far back the snapshot keeps records. 48h comfortably covers the widest
 * window (24h) plus a sleep that started before it began, at any origin hour,
 * with a day of slack for a widget that has not been refreshed in a while.
 */
export const WIDGET_LOOKBACK_MS = 2 * DAY;

/** The entry types the widget's window actually reads. */
type WidgetEntry = Extract<Entry, { type: 'sleep' | 'feeding' | 'diaper' }>;

function widgetRelevant(e: Entry): e is WidgetEntry {
  return e.type === 'sleep' || e.type === 'feeding' || e.type === 'diaper';
}

/**
 * Trim `entries` to what the widget can still need: the three types it reads,
 * within `WIDGET_LOOKBACK_MS` of `now`. Judged on the LATEST timestamp a record
 * carries (`end ?? start`, or `time` for a diaper), so a long sleep that began
 * before the cutoff but ended inside it is kept whole and the boundary split can
 * still cut it correctly.
 *
 * Pass entries already scoped to the selected child (`entriesForChild`); this
 * does no child filtering of its own.
 */
export function pruneWidgetEntries(entries: Entry[], now: number): Entry[] {
  const cutoff = now - WIDGET_LOOKBACK_MS;
  return entries.filter((e) => {
    if (!widgetRelevant(e)) return false;
    const last = e.type === 'diaper' ? e.time : (e.end ?? e.start);
    return last >= cutoff;
  });
}

/**
 * The raw material the window needs. `WidgetSnapshot` satisfies this
 * structurally, so the widget passes its snapshot straight in.
 */
export interface WidgetTodaySource {
  /** pruned records for the selected child (see `pruneWidgetEntries`) */
  entries: Entry[];
  /** start of the running sleep timer, or null */
  sleepStart: number | null;
  /** the client-wide day boundary, hour of local day */
  rhythmOriginHour: number;
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
 * The snapshot carries the running nap's START, not the whole `Timer`, so
 * rebuild the minimal shape `liveSleepMsInWindow` reads (`saveAs` + `start`).
 * That keeps the live nap going through the SAME clamp as a completed sleep
 * instead of a second inline one. Scoping (by child, and by `saveAs` rather than
 * `activity`) already happened where the snapshot was built, with `runningTimer`.
 */
function runningSleepTimers(sleepStart: number | null): Timer[] {
  if (sleepStart == null) return [];
  return [{ id: 'widget-running-sleep', activity: 'sleep', saveAs: 'sleep', name: 'Sleep', start: sleepStart }];
}

/**
 * Everything the Status widget shows about the current window, for a `now` the
 * caller supplies. A null source is the "no snapshot yet" case (widget added
 * before the first app launch, or the first run after the snapshot key was
 * bumped): there is genuinely no data, so the sleep value stays the "—"
 * placeholder rather than claiming a zero.
 *
 * With a snapshot, a real zero IS reported as `fmtDur(0)` = "0 min": that is the
 * honest answer to "how much sleep since the boundary", and it matches Home.
 */
export function widgetToday(s: WidgetTodaySource | null, now: number): WidgetToday {
  // Clamp once and use the same hour for the boundary and its label, so a junk
  // persisted value cannot make the number and the caption disagree.
  const originHour = clampHourOfDay(s?.rhythmOriginHour ?? RHYTHM_ORIGIN_DEFAULT, RHYTHM_ORIGIN_DEFAULT);
  const windowStartMs = windowStart(now, originHour);
  const entries = s?.entries ?? [];
  const sleepMin = liveSleepMsInWindow(entries, runningSleepTimers(s?.sleepStart ?? null), windowStartMs, now) / 60000;
  // Bucket by re-deriving each record's own window rather than by comparing
  // against `windowStartMs + DAY`: `windowStart` rebuilds the boundary from
  // calendar fields, so this stays right on a DST day, where the window is 23
  // or 25 hours long. Same rule (and same timestamps) as `buildTrend`'s
  // feedsPerDay and `buildDiaperSeries`.
  const inWindow = (ms: number) => windowStart(ms, originHour) === windowStartMs;
  const feeds = entries.filter((e) => e.type === 'feeding' && inWindow(e.start)).length;
  const diapers = entries.filter((e) => e.type === 'diaper' && inWindow(e.time)).length;
  // "since noon" / "since 7:00" / "since midnight": the boundary is
  // user-configurable and is NOT midnight by default, so a literal "Today"
  // actively misleads. Same phrase Home puts under its Sleep figure.
  const since = `since ${fmtDayStartHour(originHour)}`;
  return {
    windowStartMs,
    sleepMin,
    feeds,
    diapers,
    sleepValue: s ? fmtDur(sleepMin) : '—',
    todayLine: `${since} · ${feeds} feeds · ${diapers} changes`,
  };
}
