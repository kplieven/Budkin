'use no memo';

// Android home-screen widget: a single nap start/stop toggle. The whole surface is
// one tap target (clickAction NAP_TOGGLE), handled headless in the widget task
// handler, so tapping never opens the app. The accessibilityLabel sits on the root
// because that is the one element TalkBack can reach (see `napLabels`).

import { FlexWidget, SvgWidget, TextWidget } from 'react-native-android-widget';

import { fmtDur } from '@/lib/format';
import { napLabels } from '@/widgets/napLabels';
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
  const labels = napLabels({ childName: snapshot?.childName, childCount: snapshot?.childCount, napping });

  return (
    <FlexWidget
      clickAction="NAP_TOGGLE"
      accessibilityLabel={labels.accessibilityLabel}
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: napping ? SLEEP : BG,
        borderRadius: 24,
        padding: 12,
      }}
    >
      {napping ? (
        <FlexWidget style={{ flexDirection: 'column', alignItems: 'center' }}>
          <TextWidget text={labels.text} style={{ fontSize: 14, fontWeight: 'bold', color: BG }} />
          <TextWidget text={elapsed} style={{ fontSize: 26, fontWeight: 'bold', color: BG, marginTop: 2 }} />
          <TextWidget text="tap to stop" style={{ fontSize: 12, color: BG, marginTop: 2 }} />
        </FlexWidget>
      ) : (
        <FlexWidget style={{ flexDirection: 'column', alignItems: 'center' }}>
          <SvgWidget svg={activitySvg('sleep', SLEEP)} style={{ height: 34, width: 34 }} />
          <TextWidget text={labels.text} style={{ fontSize: 16, fontWeight: 'bold', color: TEXT, marginTop: 6 }} />
        </FlexWidget>
      )}
    </FlexWidget>
  );
}
