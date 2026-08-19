import { requestWidgetUpdate } from 'react-native-android-widget';

import { NapWidget } from '@/widgets/NapWidget';
import { StatusWidget } from '@/widgets/StatusWidget';
import type { WidgetSnapshot } from '@/widgets/snapshot';

/**
 * Ask every on-screen widget to re-render with the latest snapshot.
 *
 * Both the Status AND the Nap widget must be pushed. The Nap widget's whole
 * surface is a single start/stop toggle, so an unrefreshed one keeps showing a
 * stale "tap to stop" until the OS's 30-min periodic update, and a tap on that
 * stale button toggles against empty storage and starts a phantom nap: the source
 * of the 0-minute entries and spontaneous timers.
 */
export async function pushWidgetUpdate(snapshot: WidgetSnapshot): Promise<void> {
  const now = Date.now();
  try {
    requestWidgetUpdate({
      widgetName: 'Status',
      renderWidget: () => <StatusWidget snapshot={snapshot} now={now} />,
      widgetNotFound: () => {},
    });
  } catch (err) {
    // Don't swallow: a failed update is exactly why a widget silently goes stale
    // until the 30-min OS poll.
    console.warn('[widget] requestWidgetUpdate failed for the Status widget:', err);
  }
  try {
    requestWidgetUpdate({
      widgetName: 'Nap',
      renderWidget: () => <NapWidget snapshot={snapshot} now={now} />,
      widgetNotFound: () => {},
    });
  } catch (err) {
    console.warn('[widget] requestWidgetUpdate failed for the Nap widget:', err);
  }
}
