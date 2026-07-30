'use no memo';

// Android home-screen widget UI (RemoteViews via react-native-android-widget).
// `use no memo` opts out of the React Compiler; `now` is passed in (not read in
// render) to keep the render pure.
//
// Layout: a header + a flex:1 status list (fills the upper area) + a 2x2 button
// grid pinned to the bottom, so it fills a portrait cell at any height.
//
// Sized for a 2x3 cell (app.json declares 110dp x 180dp, the Android
// `70*n - 30` floor for 2 columns and 3 rows). RemoteViews is a LinearLayout
// and does not scroll, so overflow is cut off rather than reachable, and every
// number below is chosen against that floor.
//
// Height. Only the flex:1 list can absorb, so the FIXED chrome has to leave it
// something at 180dp:
//
//   16dp  root paddingVertical (8 top + 8 bottom)
//   32dp  header (14sp name ~19dp over a 9sp age line ~13dp)
//   92dp  buttons (2 rows of a 40dp button plus 3dp margins)
//   ----
//  140dp  fixed, leaving 40dp of list at the 180dp floor
//
// The list wants 45dp for its three stat rows and another 13-26dp for the
// summary line, so the whole layout needs ~198dp for a one-line summary and
// ~211dp for a wrapped one. Both sit inside the 180-220dp a three-row cell
// actually measures on real launchers, and a 3-row Pixel cell is far taller
// still. Below that the list clips from the BOTTOM (hence justifyContent
// flex-start, not space-around, which is centred and would eat the "Fed" row
// first), so the summary line goes before any stat row and the buttons, the
// thing this widget is for, never clip at all.
//
// Width. 110dp minus 20dp of side padding leaves 90dp, which several of these
// strings exceed on their own: `sleepValue` reaches "12h 34m · napping" and
// `todayLine` reaches "since midnight · 12 feeds · 8 changes". Anything of
// variable length therefore carries maxLines + truncate. Without it a long
// string wraps, and a wrap is a height overflow in disguise.

import Constants from 'expo-constants';
import { FlexWidget, SvgWidget, TextWidget } from 'react-native-android-widget';

import { ageOrDueLabel, fmtAgoShort } from '@/lib/format';
import type { WidgetSnapshot } from '@/widgets/snapshot';
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

function agoLabel(ms: number | null | undefined, now: number): string {
  if (ms == null) return '—';
  return `${fmtAgoShort(Math.max(0, Math.round((now - ms) / 60000)))} ago`;
}

function StatRow({ label, value, color }: { label: string; value: string; color: Hex }) {
  return (
    <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', alignItems: 'center', marginBottom: 5 }}>
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
        <FlexWidget style={{ width: 8, height: 8, borderRadius: 8, backgroundColor: color, marginRight: 6 }} />
        <TextWidget text={label} style={{ fontSize: 11, color: TEXT }} />
      </FlexWidget>
      {/* The value takes the leftover width rather than its natural width, so a
          long one ellipsizes inside the row instead of wrapping the row onto a
          second line. TextWidget's style has no `flex`, only FlexWidget's does,
          hence the wrapper. */}
      <FlexWidget style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' }}>
        <TextWidget text={value} maxLines={1} truncate="END" style={{ fontSize: 11, fontWeight: 'bold', color, textAlign: 'right' }} />
      </FlexWidget>
    </FlexWidget>
  );
}

function IconButton({ kind, label, color, uri }: { kind: 'feeding' | 'diaper' | 'sleep' | 'timer'; label: string; color: Hex; uri: string }) {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri }}
      style={{
        flex: 1,
        // Fixed, and deliberately the largest fixed thing here: these four are
        // the only tap targets, so they are the last thing allowed to shrink.
        // 40dp holds a 20dp icon over a 10sp label (~14dp) with 2dp between.
        height: 40,
        margin: 3,
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: SURFACE,
        borderRadius: 12,
      }}
    >
      <SvgWidget svg={activitySvg(kind, color)} style={{ height: 20, width: 20 }} />
      <TextWidget text={label} maxLines={1} truncate="END" style={{ fontSize: 10, fontWeight: 'bold', color: TEXT, marginTop: 2 }} />
    </FlexWidget>
  );
}

export function StatusWidget({ snapshot, now }: { snapshot: WidgetSnapshot | null; now: number }) {
  const s = snapshot;
  // Initial, not the whole word: "start Right" is ~85dp at the old 14sp, and the
  // header has ~90dp total to share with the child's name. "start R" at 10sp is
  // ~39dp, which leaves the name something to occupy.
  const nextSide = s?.nextSide === 'right' ? 'R' : 'L';
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

  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{ height: 'match_parent', width: 'match_parent', flexDirection: 'column', backgroundColor: BG, borderRadius: 18, paddingHorizontal: 10, paddingVertical: 8 }}
    >
      <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', alignItems: 'center' }}>
        <FlexWidget style={{ flex: 1, flexDirection: 'column' }}>
          <TextWidget text={s?.childName || 'Budkin'} maxLines={1} truncate="END" style={{ fontSize: 14, fontWeight: 'bold', color: TEXT }} />
          {age ? <TextWidget text={age} maxLines={1} truncate="END" style={{ fontSize: 9, color: DIM }} /> : <FlexWidget style={{ height: 0 }} />}
        </FlexWidget>
        <TextWidget text={`start ${nextSide}`} maxLines={1} style={{ fontSize: 10, fontWeight: 'bold', color: FEED, marginLeft: 6 }} />
      </FlexWidget>

      {/* flex-start, not space-around: this is the only region that can absorb a
          short cell, and a centred one would clip the top ("Fed", the row that
          matters most) as readily as the bottom. Anchored to the top, the
          summary line is what goes first. */}
      <FlexWidget style={{ flex: 1, flexDirection: 'column', width: 'match_parent', justifyContent: 'flex-start', marginTop: 4, marginBottom: 4 }}>
        <StatRow label="Fed" value={agoLabel(s?.lastFeedStart, now)} color={FEED} />
        <StatRow label="Sleep" value={today.sleepValue} color={SLEEP} />
        <StatRow label="Diaper" value={agoLabel(s?.lastDiaper, now)} color={DIAPER} />
        {/* Two lines, because at 90dp this string does not fit on one and a
            single line would ellipsize away the counts. Bounded so it cannot
            claim a third. */}
        <TextWidget text={today.todayLine} maxLines={2} truncate="END" style={{ fontSize: 9, color: DIM }} />
      </FlexWidget>

      <FlexWidget style={{ flexDirection: 'column', width: 'match_parent' }}>
        <FlexWidget style={{ flexDirection: 'row', width: 'match_parent' }}>
          <IconButton kind="feeding" label="Feed" color={FEED} uri={`${SCHEME}://log/feeding`} />
          <IconButton kind="diaper" label="Diaper" color={DIAPER} uri={`${SCHEME}://log/diaper`} />
        </FlexWidget>
        <FlexWidget style={{ flexDirection: 'row', width: 'match_parent' }}>
          <IconButton kind="sleep" label="Sleep" color={SLEEP} uri={`${SCHEME}://log/sleep`} />
          <IconButton kind="timer" label="Timer" color={PRIMARY} uri={`${SCHEME}://timer`} />
        </FlexWidget>
      </FlexWidget>
    </FlexWidget>
  );
}
