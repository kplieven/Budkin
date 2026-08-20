import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { isHovered } from '@/components/hover';
import { Icon, type IconName } from '@/components/Icon';
import { Tappable } from '@/components/press';
import { Txt } from '@/components/Txt';
import { ACTIVITY_LABEL } from '@/lib/activities';
import { hexA } from '@/lib/color';
import { fmtAgoShort, fmtClock, fmtDur } from '@/lib/format';
import { useTheme } from '@/theme/useTheme';
import { type ChildAttribution } from './childAttribution';
import { detailFor } from './detail';
import { isTimer, type TimelineItem } from './groupByDay';
import { timelineRowLabel } from './queuedMarker';

const RAIL_W = 26;   // width of the spine column
// Sized for the widest thing the column holds, which is not a clock but an ongoing row's
// elapsed pill. Shared by every row so the spine runs straight down the list.
const TIME_W = 62;
const NODE_TOP = 15; // vertical offset of the node/capsule from the entry top
const DOT = 12;      // point-event marker diameter
const CAP_W = 8;     // duration-capsule width
const HALO = 16;     // breathing glow diameter at an ongoing capsule's head
const CONTENT_H = 30; // content row height (== icon chip), used to center it on the marker
// The row's color wash bleeds edge-to-edge, so ROW_PAD insets the content back off the
// screen edges. History drops its container's horizontal padding to let the wash reach
// them, and re-adds a matching inset on its day labels. The spine connector is extended
// by ROW_GAP so the timeline stays continuous across the gap.
const ROW_PAD = 18;
const ROW_GAP = 8;

// Proportional but capped: a marker saturates at CAP_MIN so a long night sleep reads as
// "long" without ballooning the row. The minimum keeps a short event's capsule tall
// enough to separate its start and end clock labels.
const MIN_BAR = 28, MAX_BAR = 72, CAP_MIN = 210;
function barHeight(min: number): number {
  const clamped = Math.max(0, Math.min(min, CAP_MIN));
  return MIN_BAR + (clamped / CAP_MIN) * (MAX_BAR - MIN_BAR);
}

/**
 * Drawn behind the capsule so what shows is a ring around its head. The loop runs
 * TOWARDS full opacity rather than away from it: Reanimated snaps a timing straight to
 * its target under the system reduce-motion setting, so this way the halo comes to rest
 * visible instead of nearly gone. Its own component, as PulsingDot is, so the animation
 * hooks only exist for rows actually running.
 */
function OngoingHalo({ color, top }: { color: string; top: number }) {
  const opacity = useSharedValue(0.35);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 800 }), -1, true);
  }, [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          // centred on the capsule head, whose own centre is CAP_W/2 below `top`
          top: top + CAP_W / 2 - HALO / 2,
          left: RAIL_W / 2 - HALO / 2,
          width: HALO,
          height: HALO,
          borderRadius: HALO / 2,
          backgroundColor: hexA(color, 0.3),
        },
        style,
      ]}
    />
  );
}

/**
 * One event on the History timeline: a spine on the left with a marker, a dot for point
 * events and a duration capsule for intervals. The list runs newest-first, so an
 * interval's end sits at the capsule head and its start at the foot, and the gap between
 * the two clock labels reads as the event's real span. A running timer is the same
 * ongoing shape an interval with no end already takes, so both key off `ongoing`.
 *
 * `queued` and `child` are decided by the caller rather than read from the store here, so
 * History and the desktop rail cannot disagree, and so the rules stay testable.
 * Absent `child` means draw no chip.
 *
 * Row height is a pure function of duration, which is what lets the spine run straight
 * and the clock labels sit at a capsule's head and foot. Anything content-derived that
 * could wrap would move it, so the child chip is bounded and never shrinks, and the
 * detail text beside it absorbs a narrow screen instead.
 */
export function TimelineEntry({ item, now, onPress, isFirst, isLast, queued = false, child }: {
  item: TimelineItem; now: number; onPress: () => void; isFirst: boolean; isLast: boolean; queued?: boolean;
  child?: ChildAttribution;
}) {
  const t = useTheme();
  const timer = isTimer(item);
  const type = timer ? item.saveAs : item.type;
  const color = t.activity[type];
  const isPoint =
    !timer &&
    (item.type === 'diaper' ||
      item.type === 'bath' ||
      item.type === 'temperature' ||
      item.type === 'medication' ||
      item.type === 'note' ||
      item.type === 'milestone');
  const start = timer
    ? item.start
    : item.type === 'diaper' ||
        item.type === 'bath' ||
        item.type === 'temperature' ||
        item.type === 'medication' ||
        item.type === 'note' ||
        item.type === 'milestone'
      ? item.time
      : item.start;
  const endTs = timer
    ? null
    : item.type === 'diaper' ||
        item.type === 'bath' ||
        item.type === 'temperature' ||
        item.type === 'medication' ||
        item.type === 'note' ||
        item.type === 'milestone'
      ? null
      : item.end;
  const ongoing = !isPoint && endTs == null;

  const durMin = isPoint ? 0 : ((endTs ?? now) - start) / 60000;
  // fmtAgoShort does not round, and the raw float renders as "12.716666666m".
  const elapsedMin = Math.round(durMin);
  const bh = isPoint ? DOT : barHeight(durMin);
  const minHeight = Math.max(58, NODE_TOP + bh + 16);
  // Point events have no start/end labels bracketing the dot, so the marker is centred in
  // the row or the full-height wash leaves a lopsided gap below the content. Capsules
  // stay anchored at NODE_TOP so their clock labels line up.
  const nodeTop = isPoint ? (minHeight - bh) / 2 : NODE_TOP;
  const nodeBottom = nodeTop + bh;
  const detail = detailFor(item);

  return (
    <Tappable
      onPress={onPress}
      accessibilityRole="button"
      // Nothing the row draws may go unannounced, and the chip's name comes from the same
      // `childAttribution` call that drew it.
      accessibilityLabel={timelineRowLabel({
        activity: ACTIVITY_LABEL[type],
        ongoing,
        timer,
        elapsed: fmtDur(elapsedMin),
        queued,
        child: child?.spoken,
      })}
      style={(s) => [
        // Full-bleed wash, kept light so the spine and text stay legible in both themes.
        {
          flexDirection: 'row',
          minHeight,
          cursor: 'pointer',
          backgroundColor: hexA(color, 0.07),
          paddingHorizontal: ROW_PAD,
          marginBottom: isLast ? 0 : ROW_GAP,
        },
        isHovered(s) && { opacity: 0.85 },
      ]}
    >
      {/* clock column */}
      <View style={{ width: TIME_W, paddingRight: 8 }}>
        {isPoint ? (
          <View style={{ position: 'absolute', right: 8, top: nodeTop, height: DOT, justifyContent: 'center' }}>
            <Txt weight={600} size={13.5} style={{ fontVariant: ['tabular-nums'], textAlign: 'right' }}>
              {fmtClock(start)}
            </Txt>
          </View>
        ) : (
          <>
            {endTs != null ? (
              <Txt weight={500} size={12} color={t.faint} style={{ fontVariant: ['tabular-nums'], textAlign: 'right', marginTop: NODE_TOP - 7 }}>
                {fmtClock(endTs)}
              </Txt>
            ) : (
              // No end to show, so the slot holds how long it has been running. A label
              // wider than TIME_W spills left over the ROW_PAD inset rather than being
              // clipped, which is what sizes that constant.
              <View
                style={{
                  alignSelf: 'flex-end',
                  marginTop: NODE_TOP - 6,
                  paddingHorizontal: 4,
                  paddingVertical: 2,
                  borderRadius: 8,
                  backgroundColor: hexA(color, 0.16),
                }}
              >
                <Txt weight={700} size={11} color={color} style={{ fontVariant: ['tabular-nums'] }}>
                  {fmtAgoShort(elapsedMin)}
                </Txt>
              </View>
            )}
            <Txt weight={600} size={13.5} style={{ position: 'absolute', right: 8, top: nodeBottom - 7, fontVariant: ['tabular-nums'], textAlign: 'right' }}>
              {fmtClock(start)}
            </Txt>
          </>
        )}
      </View>

      {/* spine + marker */}
      <View style={{ width: RAIL_W }}>
        {!isFirst ? (
          <View style={{ position: 'absolute', top: 0, height: nodeTop, left: RAIL_W / 2 - 1, width: 2, backgroundColor: t.line }} />
        ) : null}
        {!isLast ? (
          <View style={{ position: 'absolute', top: nodeBottom, bottom: -ROW_GAP, left: RAIL_W / 2 - 1, width: 2, backgroundColor: t.line }} />
        ) : null}
        {isPoint ? (
          <View style={{ position: 'absolute', top: nodeTop, left: RAIL_W / 2 - DOT / 2, width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: color, borderWidth: 2.5, borderColor: t.bg }} />
        ) : (
          <>
            {/* first, so it paints behind the capsule and only rings the head */}
            {ongoing ? <OngoingHalo color={color} top={nodeTop} /> : null}
            <View style={{ position: 'absolute', top: nodeTop, left: RAIL_W / 2 - CAP_W / 2, width: CAP_W, height: bh, borderRadius: CAP_W / 2, backgroundColor: color }} />
          </>
        )}
      </View>

      {/* content: one line, vertically centered on the marker */}
      <View style={{ flex: 1, paddingLeft: 4, paddingTop: nodeTop + bh / 2 - CONTENT_H / 2, paddingBottom: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: CONTENT_H, height: CONTENT_H, borderRadius: 9, backgroundColor: hexA(color, 0.16), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={type as IconName} color={color} size={17} />
          </View>
          {/* numberOfLines so the line can never wrap: a wrapped label would change a row
              height that must stay a pure function of duration.

              `flexShrink: 0` looks redundant and is not. On web a Text lands here as a
              flex item with no `flex-shrink` of its own, so it takes CSS's initial value
              of 1 and shrinks, where a View would not (react-native-web's View base style
              sets `flex-shrink: 0`, which is why the chips need no such line). Without it
              the label came out as "Diap…" on a 390px screen. */}
          <Txt weight={700} size={16} tracking={-0.2} numberOfLines={1} style={{ flexShrink: 0 }}>
            {ACTIVITY_LABEL[type]}
          </Txt>
          {/* In the child's own avatar tint, so two siblings are told apart by colour as
              well as by name. Capped rather than shrinkable, so a long name ellipsizes
              inside its chip instead of the chip collapsing. Never focusable on its own:
              that would double the swipes needed to cross the timeline. */}
          {child?.name ? (
            <View
              style={{
                flexShrink: 0,
                maxWidth: 96,
                paddingHorizontal: 7,
                paddingVertical: 2,
                borderRadius: 7,
                backgroundColor: hexA(child.color ?? t.dim, 0.16),
              }}
            >
              <Txt weight={700} size={11.5} color={child.color ?? t.dim} numberOfLines={1}>
                {child.name}
              </Txt>
            </View>
          ) : null}
          {detail ? (
            <>
              <View style={{ width: 1, height: 18, backgroundColor: t.line }} />
              <Txt weight={500} size={14} color={t.dim} numberOfLines={1} style={{ flexShrink: 1 }}>
                {detail}
              </Txt>
            </>
          ) : null}
          {/* Still waiting to upload. No words, since the row's accessibilityLabel
              carries the state. Last in the row so it stays put while the detail
              text shrinks. */}
          {queued ? (
            <View style={{ flexShrink: 0 }}>
              <Icon name="clock" color={t.faint} size={13} />
            </View>
          ) : null}
        </View>
      </View>
    </Tappable>
  );
}
