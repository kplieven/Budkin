'use no memo';

import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import { NapWidget } from '@/widgets/NapWidget';
import { toggleNapFromWidget } from '@/widgets/napToggle';
import { readWidgetSnapshot } from '@/widgets/snapshot';
import { StatusWidget } from '@/widgets/StatusWidget';

/** Headless handler: renders each widget from the persisted snapshot, and runs
 *  the Nap widget's in-place start/stop toggle on tap (no app open). */
export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  const now = Date.now();

  // `toggleNapFromWidget` calls the render callback the moment the new state is
  // durable (before the slower notification round-trip), then awaits that
  // notification work: the tap repaints fast while the headless task stays alive
  // until everything settles.
  if (props.widgetAction === 'WIDGET_CLICK' && props.clickAction === 'NAP_TOGGLE') {
    await toggleNapFromWidget(now, (snapshot) => props.renderWidget(<NapWidget snapshot={snapshot} now={now} />));
    return;
  }

  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED': {
      const snapshot = await readWidgetSnapshot();
      props.renderWidget(
        props.widgetInfo.widgetName === 'Nap' ? (
          <NapWidget snapshot={snapshot} now={now} />
        ) : (
          <StatusWidget snapshot={snapshot} now={now} />
        ),
      );
      break;
    }
    default:
      break;
  }
}
