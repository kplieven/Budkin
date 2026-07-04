/**
 * Headless nap start/stop toggle for the home-screen widget. Runs inside the
 * widget task handler (no app, no store), mutating the same AsyncStorage the app
 * reads: start appends a sleep timer; stop appends the finished nap to the
 * offline queue (drained by the app on next open) and clears the timer. Returns
 * the snapshot the caller should render.
 */

import { enqueueEntry } from '@/data/queue';
import { buildSleepEntry, startSleepTimer } from '@/data/sleepTimer';
import { loadTimers, saveTimers } from '@/data/timers';
import { readWidgetSnapshot, writeWidgetSnapshot, type WidgetSnapshot } from '@/widgets/snapshot';

export async function toggleNapFromWidget(now: number): Promise<WidgetSnapshot | null> {
  const snap = await readWidgetSnapshot();
  if (!snap) return null; // no snapshot yet (widget added before first app launch) — nothing to toggle

  const timers = await loadTimers();
  const running = timers.find((t) => t.activity === 'sleep');

  if (running) {
    // Stop: queue the finished nap (unless demo/unconfigured) and drop the timer.
    if (snap.canQueueNap && snap.selectedChildId) {
      await enqueueEntry(buildSleepEntry(running, now, snap.selectedChildId));
    }
    await saveTimers(timers.filter((t) => t !== running));
    const next: WidgetSnapshot = { ...snap, sleepStart: null };
    await writeWidgetSnapshot(next);
    return next;
  }

  // Start: append a running sleep timer in place.
  await saveTimers([...timers, startSleepTimer(now)]);
  const next: WidgetSnapshot = { ...snap, sleepStart: now };
  await writeWidgetSnapshot(next);
  return next;
}
