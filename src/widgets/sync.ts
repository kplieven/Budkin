/**
 * Keeps the home-screen widget's data snapshot in sync with the app: whenever
 * the relevant store data changes, write a fresh snapshot and ask any on-screen
 * widgets to re-render. No-ops cleanly off Android (pushWidgetUpdate is a stub).
 */

import { useAppStore } from '@/store/useAppStore';
import { pushWidgetUpdate } from '@/widgets/pushWidgetUpdate';
import { buildWidgetSnapshot, writeWidgetSnapshot } from '@/widgets/snapshot';

let lastKey = '';
let started = false;

export function initWidgetSync(): void {
  if (started) return;
  started = true;
  const run = async (state: ReturnType<typeof useAppStore.getState>) => {
    const snap = buildWidgetSnapshot(state);
    const key = JSON.stringify(snap);
    if (key === lastKey) return;
    lastKey = key;
    await writeWidgetSnapshot(snap);
    await pushWidgetUpdate(snap);
  };
  // Gate on the slices `buildWidgetSnapshot` actually reads, which now include
  // `rhythmOriginHour`: the snapshot carries the day boundary for the widget to
  // window against, so changing it in Settings must rebuild. `now` stays OUT
  // deliberately, even though the builder takes it: the per-second tick replaces
  // nothing the widget can see (it only anchors the 48h record prune), so it
  // early-returns here. No snapshot rebuild, no JSON.stringify, and no widget
  // push on the hot path.
  useAppStore.subscribe((state, prev) => {
    if (
      state.children === prev.children &&
      state.selectedChildId === prev.selectedChildId &&
      state.entries === prev.entries &&
      state.timers === prev.timers &&
      state.connection === prev.connection &&
      state.rhythmOriginHour === prev.rhythmOriginHour
    ) {
      return;
    }
    void run(state);
  });
  void run(useAppStore.getState());
}
