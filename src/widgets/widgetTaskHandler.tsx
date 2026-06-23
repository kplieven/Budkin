'use no memo';

import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import { StatusWidget } from '@/widgets/StatusWidget';
import { readWidgetSnapshot } from '@/widgets/snapshot';

/** Headless handler that renders the widget from the persisted snapshot. */
export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED': {
      const snapshot = await readWidgetSnapshot();
      props.renderWidget(<StatusWidget snapshot={snapshot} now={Date.now()} />);
      break;
    }
    default:
      break;
  }
}
