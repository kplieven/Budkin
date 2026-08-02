'use no memo';

// Android home-screen widget UI (RemoteViews via react-native-android-widget).
// `use no memo` opts out of the React Compiler; `now` is passed in (not read in
// render) to keep the render pure.
//
// Layout: a header + a flex:1 status list (fills the upper area) + a 2x2 button
// grid pinned to the bottom, so it fills a portrait cell at any height.
//
// Nothing drawn here reaches a screen reader: the tree is rasterised to a bitmap
// first. The only five strings that survive are the root's accessibilityLabel
// and the four buttons', and they all come from `statusLabels`.

import Constants from 'expo-constants';
import { FlexWidget, SvgWidget, TextWidget } from 'react-native-android-widget';

import { withChildParam } from '@/lib/deepLink';
import { ageOrDueLabel } from '@/lib/format';
import type { WidgetSnapshot } from '@/widgets/snapshot';
import { agoMinutes, agoValue, ROW_LABEL, statusLabels, widgetTitle } from '@/widgets/statusLabels';
import type { StatusButton } from '@/widgets/statusLabels';
import { widgetToday } from '@/widgets/today';
import { activitySvg } from '@/widgets/widgetIcons';

type Hex = `#${string}`;

const BG: Hex = '#16110E';
const SURFACE: Hex = '#2C231C';
const TEXT: Hex = '#F3EBE1';
const DIM: Hex = '#B4A492';
const FEED: Hex = '#F0A878';
const SLEEP: Hex = '#A99EDC';
const DIAPER: Hex = '#6FC0A6';
const PRIMARY: Hex = '#EC9A66';

/**
 * The scheme these buttons deep-link into, read from the running app rather
 * than hardcoded. The development variant ships its own (`budkindev`, see
 * app.config.js) so that with both variants installed, a widget button cannot
 * open the other app. `scheme` is typed `string | string[]`; the array form
 * lists alternates, and the first is the canonical one.
 */
const SCHEME = (() => {
  const s = Constants.expoConfig?.scheme;
  if (Array.isArray(s)) return s[0] ?? 'budkin';
  return s ?? 'budkin';
})();

/**
 * A button's deep link, naming the child whose stats it sits under. The bitmap
 * is frozen and Android's refresh floor is 30 minutes, so the selection can have
 * moved on since it was drawn; without the child, a tap would log against
 * whoever is selected NOW while the widget still shows someone else. The route
 * refuses rather than retargets when that child is gone, see
 * `resolveLogDeepLink`. An empty snapshot names nobody and keeps the old
 * behaviour of running against the current selection.
 */
function buttonUri(path: string, s: WidgetSnapshot | null): string {
  return withChildParam(`${SCHEME}://${path}`, s?.selectedChildId);
}

/**
 * What a stat row draws when it has no value. Also what `widgetToday` puts in
 * `sleepValue` for the two cases that are not a real zero (no snapshot, unborn
 * child), which is why the sleep row is compared against it below rather than
 * having that rule restated here; `today.test.ts` pins both ends.
 */
const NO_VALUE = '—';

function StatRow({ label, value, color }: { label: string; value: string; color: Hex }) {
  return (
    <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', alignItems: 'center', justifyContent: 'space-between' }}>
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
        <FlexWidget style={{ width: 9, height: 9, borderRadius: 8, backgroundColor: color, marginRight: 9 }} />
        <TextWidget text={label} style={{ fontSize: 14, color: TEXT }} />
      </FlexWidget>
      <TextWidget text={value} style={{ fontSize: 15, fontWeight: 'bold', color }} />
    </FlexWidget>
  );
}

function IconButton({
  kind,
  label,
  accessibilityLabel,
  color,
  uri,
}: {
  kind: StatusButton;
  label: string;
  accessibilityLabel: string;
  color: Hex;
  uri: string;
}) {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri }}
      // Harvested only because this element also carries a `clickAction`; see
      // `statusLabels`. The drawn label below reaches no screen reader at all.
      accessibilityLabel={accessibilityLabel}
      style={{
        flex: 1,
        height: 60,
        margin: 4,
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: SURFACE,
        borderRadius: 16,
      }}
    >
      <SvgWidget svg={activitySvg(kind, color)} style={{ height: 28, width: 28 }} />
      <TextWidget text={label} style={{ fontSize: 12, fontWeight: 'bold', color: TEXT, marginTop: 3 }} />
    </FlexWidget>
  );
}

export function StatusWidget({ snapshot, now }: { snapshot: WidgetSnapshot | null; now: number }) {
  const s = snapshot;
  const age = s?.birth != null ? ageOrDueLabel(s.birth, s.expected, now) : '';
  // The whole day window, computed HERE from the snapshot's raw records against
  // the live `now`, so the boundary rollover self-corrects on the next refresh
  // instead of showing yesterday's totals off a frozen bitmap. All of the
  // arithmetic and both strings come from the pure module, which is the only part
  // of this widget a test can reach.
  //
  // The Sleep row is always the day total, live nap included, matching Home: the
  // old "current nap only while napping" discarded every logged sleep, the exact
  // bug Home already fixed. The napping signal moved into the value ("2h · napping")
  // rather than flipping this row's label, because "Napping 2h" claims to be the
  // nap's length when the number is the whole window. The summary line below names
  // the boundary the figures count from.
  const today = widgetToday(s, now);
  // The minute counts, taken once. Both readings of each figure hang off the
  // same integer: the row below draws it compactly, the label speaks it in full.
  const fedMin = agoMinutes(s?.lastFeedStart, now);
  const diaperMin = agoMinutes(s?.lastDiaper, now);
  // Every string a screen reader can reach, plus the header's side line, which
  // the tile draws and says differently. All of it is built from the very values
  // drawn below, so the two can never disagree. The tile is a bitmap by the time
  // Android sees it, so without these it announces nothing at all.
  const labels = statusLabels({
    childName: s?.childName,
    childCount: s?.childCount,
    age,
    side: s ? (s.nextSide === 'right' ? 'right' : 'left') : null,
    expected: !!s?.expected,
    fedMin,
    diaperMin,
    sleepMin: today.sleepValue === NO_VALUE ? null : today.sleepMin,
    napping: s?.sleepStart != null,
    today: today.todayLine,
  });

  return (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel={labels.root}
      style={{ height: 'match_parent', width: 'match_parent', flexDirection: 'column', backgroundColor: BG, borderRadius: 24, padding: 16 }}
    >
      <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', justifyContent: 'space-between', alignItems: 'center' }}>
        <FlexWidget style={{ flexDirection: 'column' }}>
          <TextWidget text={widgetTitle(s?.childName)} style={{ fontSize: 18, fontWeight: 'bold', color: TEXT }} />
          {age ? <TextWidget text={age} style={{ fontSize: 12, color: DIM }} /> : <FlexWidget style={{ height: 0 }} />}
        </FlexWidget>
        <TextWidget text={labels.sideText} style={{ fontSize: 14, fontWeight: 'bold', color: FEED }} />
      </FlexWidget>

      <FlexWidget style={{ flex: 1, flexDirection: 'column', width: 'match_parent', justifyContent: 'space-around', marginTop: 6, marginBottom: 6 }}>
        <StatRow label={ROW_LABEL.fed} value={agoValue(fedMin) ?? NO_VALUE} color={FEED} />
        <StatRow label={ROW_LABEL.sleep} value={today.sleepValue} color={SLEEP} />
        <StatRow label={ROW_LABEL.diaper} value={agoValue(diaperMin) ?? NO_VALUE} color={DIAPER} />
        <TextWidget text={today.todayLine} style={{ fontSize: 12, color: DIM }} />
      </FlexWidget>

      <FlexWidget style={{ flexDirection: 'column', width: 'match_parent' }}>
        <FlexWidget style={{ flexDirection: 'row', width: 'match_parent' }}>
          <IconButton kind="feeding" label="Feed" accessibilityLabel={labels.buttons.feeding} color={FEED} uri={buttonUri('log/feeding', s)} />
          <IconButton kind="diaper" label="Diaper" accessibilityLabel={labels.buttons.diaper} color={DIAPER} uri={buttonUri('log/diaper', s)} />
        </FlexWidget>
        <FlexWidget style={{ flexDirection: 'row', width: 'match_parent' }}>
          <IconButton kind="sleep" label="Sleep" accessibilityLabel={labels.buttons.sleep} color={SLEEP} uri={buttonUri('log/sleep', s)} />
          <IconButton kind="timer" label="Timer" accessibilityLabel={labels.buttons.timer} color={PRIMARY} uri={buttonUri('timer', s)} />
        </FlexWidget>
      </FlexWidget>
    </FlexWidget>
  );
}
