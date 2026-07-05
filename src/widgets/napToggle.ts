/**
 * Headless nap start/stop toggle for the home-screen widget. Runs inside the
 * widget task handler (no app, no store), mutating the same AsyncStorage the app
 * reads: start appends a sleep timer; stop appends the finished nap to the
 * offline queue (drained by the app on next open) and clears the timer. Returns
 * the snapshot the caller should render.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { enqueueEntry } from '@/data/queue';
import { buildSleepEntry, startSleepTimer } from '@/data/sleepTimer';
import { loadTimers, saveTimers } from '@/data/timers';
import { buildTimerNotification } from '@/notifications/content';
import { dismissTimerNotification, postTimerNotification } from '@/notifications/postNotification';
import { readWidgetSnapshot, writeWidgetSnapshot, type WidgetSnapshot } from '@/widgets/snapshot';

// Android can re-deliver a widget click (and a physical bounce can double-fire),
// so a single tap may invoke this handler more than once within a few ms. Because
// the toggle flips state, two back-to-back invocations would go start→stop→start,
// logging a start≈end 0-minute nap and leaving a phantom timer running. Ignore any
// toggle that lands within this window of the last accepted one — long enough to
// swallow duplicate delivery and fumbled double-taps, far shorter than any real nap.
const TOGGLE_GUARD_KEY = 'babybuddy.napToggleAt.v1';
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

export async function toggleNapFromWidget(now: number): Promise<WidgetSnapshot | null> {
  const snap = await readWidgetSnapshot();
  if (!snap) return null; // no snapshot yet (widget added before first app launch) — nothing to toggle

  // Debounce duplicate/rapid delivery: re-render the widget from the current
  // snapshot without mutating any timer or logging an entry.
  const lastAt = await readLastToggleAt();
  if (lastAt != null && now - lastAt < TOGGLE_MIN_INTERVAL_MS) return snap;
  await writeLastToggleAt(now);

  const timers = await loadTimers();
  const running = timers.find((t) => t.activity === 'sleep');

  if (running) {
    // Stop: queue the finished nap (unless demo/unconfigured) and drop the timer.
    if (snap.canQueueNap && snap.selectedChildId) {
      await enqueueEntry(buildSleepEntry(running, now, snap.selectedChildId));
    }
    await saveTimers(timers.filter((t) => t !== running));
    await dismissTimerNotification(running.id);
    const next: WidgetSnapshot = { ...snap, sleepStart: null };
    await writeWidgetSnapshot(next);
    return next;
  }

  // Start: append a running sleep timer in place.
  const timer = startSleepTimer(now);
  await saveTimers([...timers, timer]);
  const next: WidgetSnapshot = { ...snap, sleepStart: now };
  await writeWidgetSnapshot(next);
  await postTimerNotification(buildTimerNotification(timer, snap.childName));
  return next;
}
