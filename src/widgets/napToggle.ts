/**
 * Headless nap start/stop toggle for the home-screen widget. Runs inside the widget task
 * handler, with no app and no store, mutating the same AsyncStorage the app reads.
 *
 * `render` is a callback rather than a return value: it fires the instant the new state
 * is durable and before the expo-notifications native round-trip, so the tap repaints
 * immediately. The notification work is still awaited afterwards, keeping the headless
 * task alive until it completes.
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

// Android can re-deliver a widget click, so one tap may invoke this handler more than
// once within a few ms. Since the toggle flips state, two back-to-back invocations go
// start→stop→start, logging a 0-minute nap and leaving a phantom timer running.
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
  // Fired together: sequentially these are four AsyncStorage round-trips in front of the
  // repaint. There is no store out here, so the nap window has to come from disk.
  const [snap, lastAt, timers, prefs] = await Promise.all([
    readWidgetSnapshot(),
    readLastToggleAt(),
    loadTimers(),
    loadPrefs(),
  ]);
  // `??`, not `||`: 0 is midnight, which a truthy fallback would replace with 07:00.
  const napWindow: NapWindow = {
    startMin: prefs.napWindowStartMin ?? NAP_WINDOW_START_DEFAULT,
    endMin: prefs.napWindowEndMin ?? NAP_WINDOW_END_DEFAULT,
  };

  if (!snap) {
    render(null); // widget added before the first app launch: nothing to toggle
    return;
  }

  if (snap.expected) {
    // Not born yet. Repaint from the untouched snapshot so the tap still gets feedback.
    render(snap);
    return;
  }

  if (!snap.selectedChildId) {
    // A fresh install writes a baseline snapshot with an empty id before onboarding. The
    // scoped lookup below would never match a timer stamped with an empty id, so every
    // tap would start another one and leave the widget stuck on "napping".
    render(snap);
    return;
  }

  // Debounced taps still repaint, so a swallowed tap never feels dead.
  if (lastAt != null && now - lastAt < TOGGLE_MIN_INTERVAL_MS) {
    render(snap);
    return;
  }
  await writeLastToggleAt(now);

  // The SAME lookup `buildWidgetSnapshot` uses for `sleepStart`, and it has to stay that
  // way: if the render rule and this tap rule disagree, a tap on a widget showing
  // "napping" finds no timer and starts a second one. Scoped to the selected child, so a
  // sibling's running nap is deliberately not stoppable here; the unscoped version filed
  // the stopped nap against `snap.selectedChildId` whoever it belonged to. A timer with
  // no owner matches nobody, since stamping those is the store's job in `hydrate`.
  const running = runningTimer(timers, 'sleep', snap.selectedChildId);

  if (running) {
    // Stop: queue the finished nap (unless demo/unconfigured) and drop the timer.
    const entry = buildSleepEntry(running, now, snap.selectedChildId, napWindow);
    if (snap.canQueueNap && snap.selectedChildId) {
      await enqueueEntry(entry);
    }
    await saveTimers(timers.filter((t) => t !== running));
    // The sleep total is derived from the snapshot's records, so carrying them forward
    // unchanged would drop the just-finished nap out of the figure until the app next
    // ran. Re-pruned so the lookback stays bounded.
    const next: WidgetSnapshot = { ...snap, sleepStart: null, entries: pruneWidgetEntries([...(snap.entries ?? []), entry], now) };
    await writeWidgetSnapshot(next);
    render(next);
    await dismissTimerNotification(running.id);
    return;
  }

  // Stamped with the selected child so a later stop, possibly from the app after the
  // selection has moved on, cannot misattribute it.
  const timer = startSleepTimer(now, snap.selectedChildId);
  await saveTimers([...timers, timer]);
  const next: WidgetSnapshot = { ...snap, sleepStart: now };
  await writeWidgetSnapshot(next);
  render(next);
  // The name-shaped builder, because there is no roster out here to resolve the timer's
  // child from. `snap.childName` is that child by construction.
  await postTimerNotification(buildNamedTimerNotification(timer, snap.childName));
}
