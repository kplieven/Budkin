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
// something at 180dp. Taking a text line as roughly 1.35x its sp:
//
//   12dp  root paddingVertical (6 + 6)
//   32dp  header (14sp name ~19dp over a 9sp age line ~13dp)
//   88dp  buttons (2 rows of a 38dp button plus 3dp margins)
//   ----
//  132dp  fixed, leaving 48dp of list at the 180dp floor
//
// The list holds three 15dp stat rows on 3dp gaps (54dp) inside 3dp margins
// (6dp), then the summary line at 9sp, which is 13dp on one line and 26dp when
// it wraps. So the whole thing wants 192dp for the stat rows alone, 205dp with
// a one-line summary, 218dp with a wrapped one.
//
// At the declared 180dp floor that does NOT all fit, and is not meant to: 192
// against 180 is a 12dp deficit, so the summary line goes entirely and the
// Diaper row loses roughly 12dp. From 205dp up everything is whole, and a
// three-row cell on a phone is far taller again (a Pixel row is ~120dp), so
// the floor is the pathological case and not the ordinary one.
//
// What the deficit must never take is a button. The list clips from the BOTTOM
// (hence justifyContent flex-start, not space-around, which is centred and
// would eat the "Fed" row first), and the buttons sit below it as a fixed,
// non-weighted child, so LinearLayout clamps the list's weight at 0 before it
// touches them. The thing this widget is FOR survives every size the launcher
// can hand it.
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
    <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', alignItems: 'center', marginBottom: 3 }}>
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

function IconButton({ kind, label, a11y, color, uri }: { kind: 'feeding' | 'diaper' | 'sleep' | 'timer'; label: string; a11y: string; color: Hex; uri: string }) {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri }}
      // Spelled out for screen readers, because the visible label is a
      // deliberately tiny abbreviation of the action (see allowFontScaling
      // below). WidgetFactory.java only reads accessibilityLabel off props that
      // also carry a clickAction, which this has.
      accessibilityLabel={a11y}
      style={{
        flex: 1,
        // Fixed, and deliberately the largest fixed thing here: these four are
        // the only tap targets, so they are the last thing allowed to shrink.
        // 38dp holds a 20dp icon over a 10sp label (~14dp) with 2dp between.
        height: 38,
        margin: 3,
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: SURFACE,
        borderRadius: 12,
      }}
    >
      <SvgWidget svg={activitySvg(kind, color)} style={{ height: 20, width: 20 }} />
      {/* allowFontScaling defaults to TRUE and TextWidget.java hands the size
          over in SP unless it is explicitly false, so this label would grow
          with the system font setting while the 38dp box above did not: ~35.5dp
          of content at scale 1.0 leaves 2.5dp of slack, and clipping would
          start around 1.2x and be severe at Android 14's 2.0x.
          Fixed by pinning the label rather than by letting the button wrap its
          content, because a wrapping button is the one thing that can break the
          invariant this layout is built on. At 2.0x a wrap_content grid comes to
          ~130dp which, with a header that has scaled to ~62dp, puts the fixed
          chrome at ~204dp: past the 180dp cell, so the buttons themselves would
          be cut. Pinned, the chrome tops out at ~162dp at 2.0x and every tap
          target survives. The cost is a label that stays small, which the icon's
          size and colour and the accessibilityLabel above between them cover. */}
      <TextWidget text={label} maxLines={1} truncate="END" allowFontScaling={false} style={{ fontSize: 10, fontWeight: 'bold', color: TEXT, marginTop: 2 }} />
    </FlexWidget>
  );
}

export function StatusWidget({ snapshot, now }: { snapshot: WidgetSnapshot | null; now: number }) {
  const s = snapshot;
  // Initial, not the whole word. The header shares ~90dp: at the 10sp it now
  // renders at, "start Right" takes ~57dp and leaves the name ~27dp, while
  // "start R" takes ~39dp and leaves it ~45dp. Not a huge saving in absolute
  // terms, but it is the difference between a name that ellipsizes after two
  // characters and one that shows a short name whole.
  const nextSide = s?.nextSide === 'right' ? 'R' : 'L';
  // The abbreviation is new here: every other surface spells the side out. It
  // is readable in context and the widget opens the app on tap, but a screen
  // reader would otherwise get the literal "start R", so it is spelled out
  // below. That needs a clickAction to survive: WidgetFactory.java reads
  // accessibilityLabel only off props that also carry one. OPEN_APP matches
  // what the root already does, so the tap behaviour is unchanged.
  const nextSideLabel = `Next feed starts on the ${s?.nextSide === 'right' ? 'right' : 'left'}`;
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
      style={{ height: 'match_parent', width: 'match_parent', flexDirection: 'column', backgroundColor: BG, borderRadius: 18, paddingHorizontal: 10, paddingVertical: 6 }}
    >
      <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', alignItems: 'center' }}>
        <FlexWidget style={{ flex: 1, flexDirection: 'column' }}>
          <TextWidget text={s?.childName || 'Budkin'} maxLines={1} truncate="END" style={{ fontSize: 14, fontWeight: 'bold', color: TEXT }} />
          {age ? <TextWidget text={age} maxLines={1} truncate="END" style={{ fontSize: 9, color: DIM }} /> : <FlexWidget style={{ height: 0 }} />}
        </FlexWidget>
        <TextWidget
          text={`start ${nextSide}`}
          maxLines={1}
          clickAction="OPEN_APP"
          accessibilityLabel={nextSideLabel}
          style={{ fontSize: 10, fontWeight: 'bold', color: FEED, marginLeft: 6 }}
        />
      </FlexWidget>

      {/* flex-start, not space-around: this is the only region that can absorb a
          short cell, and a centred one would clip the top ("Fed", the row that
          matters most) as readily as the bottom. Anchored to the top, the
          summary line is what goes first. */}
      <FlexWidget style={{ flex: 1, flexDirection: 'column', width: 'match_parent', justifyContent: 'flex-start', marginTop: 3, marginBottom: 3 }}>
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
          <IconButton kind="feeding" label="Feed" a11y="Log a feed" color={FEED} uri={`${SCHEME}://log/feeding`} />
          <IconButton kind="diaper" label="Diaper" a11y="Log a diaper change" color={DIAPER} uri={`${SCHEME}://log/diaper`} />
        </FlexWidget>
        <FlexWidget style={{ flexDirection: 'row', width: 'match_parent' }}>
          <IconButton kind="sleep" label="Sleep" a11y="Log sleep" color={SLEEP} uri={`${SCHEME}://log/sleep`} />
          <IconButton kind="timer" label="Timer" a11y="Open timers" color={PRIMARY} uri={`${SCHEME}://timer`} />
        </FlexWidget>
      </FlexWidget>
    </FlexWidget>
  );
}
