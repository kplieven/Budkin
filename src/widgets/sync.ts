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
  // Gate on the slices `buildWidgetSnapshot` actually reads. The per-second `now`
  // tick replaces nothing else, so it early-returns here — no snapshot rebuild,
  // no JSON.stringify, no widget push on the hot path.
  useAppStore.subscribe((state, prev) => {
    if (
      state.children === prev.children &&
      state.selectedChildId === prev.selectedChildId &&
      state.entries === prev.entries &&
      state.timers === prev.timers &&
      state.connection === prev.connection
    ) {
      return;
    }
    void run(state);
  });
  void run(useAppStore.getState());
}
