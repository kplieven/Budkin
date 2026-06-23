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
  const run = async () => {
    const snap = buildWidgetSnapshot(useAppStore.getState());
    const key = JSON.stringify(snap);
    if (key === lastKey) return;
    lastKey = key;
    await writeWidgetSnapshot(snap);
    await pushWidgetUpdate(snap);
  };
  useAppStore.subscribe(run);
  void run();
}
