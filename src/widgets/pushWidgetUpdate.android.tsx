import { requestWidgetUpdate } from 'react-native-android-widget';

import { StatusWidget } from '@/widgets/StatusWidget';
import type { WidgetSnapshot } from '@/widgets/snapshot';

/** Ask any on-screen Status widgets to re-render with the latest snapshot. */
export async function pushWidgetUpdate(snapshot: WidgetSnapshot): Promise<void> {
  try {
    const now = Date.now();
    requestWidgetUpdate({
      widgetName: 'Status',
      renderWidget: () => <StatusWidget snapshot={snapshot} now={now} />,
      widgetNotFound: () => {},
    });
  } catch {
    /* widget not present / not android */
  }
}
