import { requestWidgetUpdate } from 'react-native-android-widget';

import { NapWidget } from '@/widgets/NapWidget';
import { StatusWidget } from '@/widgets/StatusWidget';
import type { WidgetSnapshot } from '@/widgets/snapshot';

/**
 * Ask every on-screen widget to re-render with the latest snapshot.
 *
 * Both the Status AND the Nap widget must be pushed: the Nap widget's whole
 * surface is a single start/stop toggle, so if it isn't refreshed after the app
 * (or the widget itself, via a queued write) changes the sleep state, it keeps
 * showing a stale "tap to stop" until the OS's 30-min periodic update. A user
 * tapping that stale button toggles against empty storage and starts a phantom
 * nap — the source of the 0-minute entries and spontaneous timers. Refreshing it
 * here keeps what the user sees in lock-step with the actual timer state.
 */
export async function pushWidgetUpdate(snapshot: WidgetSnapshot): Promise<void> {
  const now = Date.now();
  try {
    requestWidgetUpdate({
      widgetName: 'Status',
      renderWidget: () => <StatusWidget snapshot={snapshot} now={now} />,
      widgetNotFound: () => {},
    });
  } catch {
    /* widget not present / not android */
  }
  try {
    requestWidgetUpdate({
      widgetName: 'Nap',
      renderWidget: () => <NapWidget snapshot={snapshot} now={now} />,
      widgetNotFound: () => {},
    });
  } catch {
    /* widget not present / not android */
  }
}
