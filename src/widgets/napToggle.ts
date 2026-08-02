/**
 * Headless nap start/stop toggle for the home-screen widget. Runs inside the
 * widget task handler (no app, no store), mutating the same AsyncStorage the app
 * reads: start appends a sleep timer; stop appends the finished nap to the
 * offline queue (drained by the app on next open) and clears the timer.
 *
 * The caller passes a `render` callback rather than reading a return value: we
 * invoke it the instant the new state is durable (timers + snapshot + queue
 * write on stop) and BEFORE the expo-notifications native round-trip, so the tap
 * repaints the widget immediately instead of waiting on the notification call.
 * The notification work is still awaited afterwards, keeping the headless task
 * alive until it completes (never fire-and-forget into a torn-down context).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { loadPrefs } from '@/data/prefs';
import { enqueueEntry } from '@/data/queue';
import { buildSleepEntry, startSleepTimer } from '@/data/sleepTimer';
import { loadTimers, saveTimers } from '@/data/timers';
import { buildNamedTimerNotification } from '@/notifications/content';
import { dismissTimerNotification, postTimerNotification } from '@/notifications/postNotification';
import { NAP_WINDOW_END_DEFAULT, NAP_WINDOW_START_DEFAULT, runningTimer, type NapWindow } from '@/store/selectors';
import { readWidgetSnapshot, writeWidgetSnapshot, type WidgetSnapshot } from '@/widgets/snapshot';
import { pruneWidgetEntries } from '@/widgets/today';

// Android can re-deliver a widget click (and a physical bounce can double-fire),
// so a single tap may invoke this handler more than once within a few ms. Because
// the toggle flips state, two back-to-back invocations would go start→stop→start,
// logging a start≈end 0-minute nap and leaving a phantom timer running. Ignore any
// toggle that lands within this window of the last accepted one — long enough to
// swallow duplicate delivery and fumbled double-taps, far shorter than any real nap.
const TOGGLE_GUARD_KEY = 'budkin.napToggleAt.v1';
const TOGGLE_MIN_INTERVAL_MS = 1500;

async function readLastToggleAt(): Promise<number | null> {
  try {
    const v = await AsyncStorage.getItem(TOGGLE_GUARD_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

async function writeLastToggleAt(now: number): Promise<void> {
  try {
    await AsyncStorage.setItem(TOGGLE_GUARD_KEY, String(now));
  } catch {
    /* ignore */
  }
}

export async function toggleNapFromWidget(
  now: number,
  render: (snapshot: WidgetSnapshot | null) => void,
): Promise<void> {
  // These reads are independent, so fire them together: on the tap's hot path
  // they were sequential AsyncStorage round-trips before the widget could
  // repaint. `loadPrefs` joins them rather than being read lazily in the stop
  // branch, where it would add a serial round-trip in front of the repaint.
  // There is no store out here, so the nap window has to come from disk.
  const [snap, lastAt, timers, prefs] = await Promise.all([
    readWidgetSnapshot(),
    readLastToggleAt(),
    loadTimers(),
    loadPrefs(),
  ]);
  // `?? default`, not `||`: 0 is midnight, a legitimate boundary that a truthy
  // fallback would silently replace with 07:00.
  const napWindow: NapWindow = {
    startMin: prefs.napWindowStartMin ?? NAP_WINDOW_START_DEFAULT,
    endMin: prefs.napWindowEndMin ?? NAP_WINDOW_END_DEFAULT,
  };

  if (!snap) {
    render(null); // no snapshot yet (widget added before first app launch) — nothing to toggle
    return;
  }

  if (snap.expected) {
    // The selected child hasn't been born yet: refuse to start or stop a nap
    // against them. Repaint from the current (untouched) snapshot so the tap
    // still gets feedback instead of feeling dead.
    render(snap);
    return;
  }

  if (!snap.selectedChildId) {
    // No child selected (a fresh install writes a baseline snapshot with an empty
    // id before onboarding). There is nobody to file a nap against, and the
    // scoped lookup below would never find a timer stamped with an empty id, so
    // every tap would start another one and leave the widget stuck on "napping".
    // Repaint so the tap still gets feedback.
    render(snap);
    return;
  }

  // Debounce duplicate/rapid delivery: repaint the widget from the current
  // snapshot without mutating any timer or logging an entry. Repainting (rather
  // than doing nothing) keeps a swallowed tap from feeling dead.
  if (lastAt != null && now - lastAt < TOGGLE_MIN_INTERVAL_MS) {
    render(snap);
    return;
  }
  await writeLastToggleAt(now);

  // The SAME lookup `buildWidgetSnapshot` uses for `sleepStart`, and it has to
  // stay that way: if the render rule and this tap rule disagree, a tap on a
  // widget that shows "napping" finds no timer and starts a SECOND one. Keyed on
  // `saveAs`, and scoped to the selected child, which is a deliberate behaviour
  // change: a sibling's running nap can no longer be stopped from the widget. A
  // widget shows one child, and the unscoped version was a misattribution bug,
  // filing the stopped nap against `snap.selectedChildId` whoever it belonged to.
  // (The Timers tab stays the multi-child surface where any timer is stoppable.)
  // A timer carrying NO owner matches nobody here. Migrating those is the store's
  // job, in `hydrate`, and this task runs with no store, so a legacy unowned
  // timer is invisible to the widget until the app next cold-starts WITH a
  // connection and a born child selected (see `stampTimerOwners` for why merely
  // opening the app is not always enough).
  const running = runningTimer(timers, 'sleep', snap.selectedChildId);

  if (running) {
    // Stop: queue the finished nap (unless demo/unconfigured) and drop the timer.
    const entry = buildSleepEntry(running, now, snap.selectedChildId, napWindow);
    if (snap.canQueueNap && snap.selectedChildId) {
      await enqueueEntry(entry);
    }
    await saveTimers(timers.filter((t) => t !== running));
    // Append the nap we just built to the snapshot's records. The sleep total is
    // now always shown and is derived from these, so carrying them forward
    // unchanged would drop the just-finished nap out of the figure the instant
    // the timer stopped, and leave it wrong until the app next ran. Re-pruned so
    // the lookback stays bounded. `rhythmOriginHour` rides along in `...snap`:
    // the app owns that field and rewrites the snapshot whenever it changes, so
    // there is nothing for the headless task to freshen.
    const next: WidgetSnapshot = { ...snap, sleepStart: null, entries: pruneWidgetEntries([...(snap.entries ?? []), entry], now) };
    await writeWidgetSnapshot(next);
    render(next); // repaint now — state is durable; dismiss the notification after.
    await dismissTimerNotification(running.id);
    return;
  }

  // Start: append a running sleep timer in place, stamped with the currently
  // selected child so a later stop (possibly from the app after the selected
  // child has changed) can't misattribute it. `snap.expected` was already
  // checked above, so `snap.selectedChildId` here is always a born child.
  const timer = startSleepTimer(now, snap.selectedChildId);
  await saveTimers([...timers, timer]);
  const next: WidgetSnapshot = { ...snap, sleepStart: now };
  await writeWidgetSnapshot(next);
  render(next); // repaint now — state is durable; post the notification after.
  // The name-shaped builder, because there is no roster out here to resolve the
  // timer's child from. Correct by construction anyway: the timer was just
  // stamped with `snap.selectedChildId`, and `snap.childName` is that child.
  await postTimerNotification(buildNamedTimerNotification(timer, snap.childName));
}
