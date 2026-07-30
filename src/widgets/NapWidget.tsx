'use no memo';

// Android home-screen widget: a single nap start/stop toggle. The whole surface
// is one tap target (clickAction NAP_TOGGLE), handled headless in the widget
// task handler — tapping never opens the app. `now` is passed in (not read in
// render) to keep the render pure, mirroring StatusWidget.
//
// Sized for a true 2x1 cell (app.json declares minHeight 40dp, the Android
// `70*rows - 30` floor for one row). RemoteViews is a LinearLayout and does not
// scroll, so anything taller than the cell is simply cut off. Both states are
// therefore ONE row, icon beside text:
//
//   napping: 6dp+6dp padding + a 16sp line (~22dp) = ~34dp
//   idle:    6dp+6dp padding + a 20dp icon        = ~32dp
//
// Both clear 40dp. That is why the old stacked layout is gone: "● Napping" over
// a 26sp duration over "tap to stop" came to ~90dp, more than twice a one-row
// cell. It fit the old `minHeight: "110dp"`, which is the two-row floor, and
// that is exactly why it went unnoticed until the widget was declared 2x1.
// The dropped copy is not lost information. The purple fill plus a running
// duration already say "napping", and `accessibilityLabel` still spells out the
// action for screen readers, which is where "tap to stop" actually mattered.

import { FlexWidget, SvgWidget, TextWidget } from 'react-native-android-widget';

import { fmtDur } from '@/lib/format';
import type { WidgetSnapshot } from '@/widgets/snapshot';
import { activitySvg } from '@/widgets/widgetIcons';

type Hex = `#${string}`;

const BG: Hex = '#16110E';
const TEXT: Hex = '#F3EBE1';
const SLEEP: Hex = '#A99EDC';

export function NapWidget({ snapshot, now }: { snapshot: WidgetSnapshot | null; now: number }) {
  const sleepStart = snapshot?.sleepStart ?? null;
  const napping = sleepStart != null;
  const elapsed = napping ? fmtDur((now - sleepStart) / 60000) : '';

  return (
    <FlexWidget
      clickAction="NAP_TOGGLE"
      accessibilityLabel={napping ? 'Stop nap' : 'Start nap'}
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: napping ? SLEEP : BG,
        borderRadius: 16,
        paddingHorizontal: 8,
        paddingVertical: 6,
      }}
    >
      {napping ? (
        <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
          <SvgWidget svg={activitySvg('sleep', BG)} style={{ height: 18, width: 18 }} />
          {/* maxLines guards the height budget: an unbounded wrap would silently
              become a second line and push the row past a one-row cell. */}
          <TextWidget text={elapsed} maxLines={1} truncate="END" style={{ fontSize: 16, fontWeight: 'bold', color: BG, marginLeft: 6 }} />
        </FlexWidget>
      ) : (
        <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
          <SvgWidget svg={activitySvg('sleep', SLEEP)} style={{ height: 20, width: 20 }} />
          <TextWidget text="Start nap" maxLines={1} truncate="END" style={{ fontSize: 12, fontWeight: 'bold', color: TEXT, marginLeft: 6 }} />
        </FlexWidget>
      )}
    </FlexWidget>
  );
}
