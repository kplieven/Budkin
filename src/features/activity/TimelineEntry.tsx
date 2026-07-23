import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { isHovered } from '@/components/hover';
import { Icon, type IconName } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { ACTIVITY_LABEL } from '@/lib/activities';
import { hexA } from '@/lib/color';
import { fmtAgoShort, fmtClock, fmtDur } from '@/lib/format';
import { useTheme } from '@/theme/useTheme';
import { detailFor } from './detail';
import { isTimer, type TimelineItem } from './groupByDay';

const RAIL_W = 26;   // width of the spine column
// Width of the clock column. Sized for the widest thing it holds, which is not a
// clock but an ongoing row's elapsed pill ("11h30m" plus its padding). Shared by
// every row so the spine runs straight down the list instead of jogging sideways
// at each running one.
const TIME_W = 62;
const NODE_TOP = 15; // vertical offset of the node/capsule from the entry top
const DOT = 12;      // point-event marker diameter
const CAP_W = 8;     // duration-capsule width
const HALO = 16;     // breathing glow diameter at an ongoing capsule's head
const CONTENT_H = 30; // content row height (== icon chip), used to center it on the marker
// The row's color wash bleeds edge-to-edge; ROW_PAD insets the content back off
// the screen edges (History drops its container's horizontal padding to let the
// wash reach them, and its day labels/header re-add a matching inset). ROW_GAP is
// the breathing room between rows — the spine connector is extended by ROW_GAP so
// the timeline stays continuous across the gap.
const ROW_PAD = 18;
const ROW_GAP = 8;

// Duration -> capsule height, proportional but CAPPED: a marker saturates at
// CAP_MIN so a long night sleep reads as "long" without ballooning the row (and
// leaving a wall of whitespace). The minimum keeps a short event's capsule tall
// enough to separate its start and end clock labels.
const MIN_BAR = 28, MAX_BAR = 72, CAP_MIN = 210;
function barHeight(min: number): number {
  const clamped = Math.max(0, Math.min(min, CAP_MIN));
  return MIN_BAR + (clamped / CAP_MIN) * (MAX_BAR - MIN_BAR);
}

/**
 * The glow that breathes at the head of an ongoing capsule. Drawn behind the
 * capsule, so what shows is a ring around the head: the list is newest-first, so
 * the head is `now`, the one edge of the marker that is still growing.
 *
 * Same 800ms reversing loop as PulsingDot, so a running row here reads as the
 * same "live" as the running-timer card on the dashboard and the Timers tab.
 * The loop runs TOWARDS full opacity rather than away from it: Reanimated snaps
 * a timing straight to its target value under the system reduce-motion setting,
 * so this way the halo comes to rest visible instead of nearly gone.
 *
 * Its own component, as PulsingDot is, so the animation hooks only exist for the
 * rows that are actually running rather than once per row in the list.
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
 * One event on the History timeline: a continuous spine on the left with a
 * marker (a dot for point events like diapers, a duration capsule for intervals
 * like sleep/feeds). The list runs newest-first, so an interval's newer edge
 * (its end) sits at the capsule head and its start at the foot — the gap between
 * the two clock labels reads as the event's real span. `isFirst`/`isLast` trim
 * the spine so it doesn't overhang a day group.
 *
 * A running timer is one of these too: it is exactly the ongoing shape the row
 * already draws for an interval with no end, so its capsule grows to `now`.
 * `saveAs` stands in for `type` and drives the icon, colour and label.
 *
 * An ongoing row says so three ways, all keyed off `ongoing` and so shared by a
 * running timer and an entry that has no end yet (both really are still going,
 * and the capsule already grows to `now` for both):
 *
 * - Its capsule is full colour. It used to be 45% alpha, which read as "faded,
 *   less important" rather than "live".
 * - A halo breathes at the capsule head. See OngoingHalo.
 * - The empty end-clock slot holds an elapsed pill instead. Tinted like the
 *   row's icon chip so it breaks the column's rhythm of right-aligned times and
 *   cannot be scanned as one.
 */
export function TimelineEntry({ item, now, onPress, isFirst, isLast }: {
  item: TimelineItem; now: number; onPress: () => void; isFirst: boolean; isLast: boolean;
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
  // A running timer has no end by definition, so `ongoing` below turns true for
  // it through the very same rule an unfinished entry follows.
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
  // Rounded once here for the elapsed pill and the accessibility label. Neither
  // fmtAgoShort nor barHeight's caller rounds, and the raw float would render as
  // "12.716666666m".
  const elapsedMin = Math.round(durMin);
  const bh = isPoint ? DOT : barHeight(durMin);
  const minHeight = Math.max(58, NODE_TOP + bh + 16);
  // Point events are a single dot with no start/end labels bracketing it, so
  // center the marker cluster (clock, dot, content) in the row — otherwise the
  // full-height color wash leaves a lopsided gap below the content. Duration
  // capsules stay anchored at NODE_TOP so their start/end clock labels sit at
  // the capsule's head and foot.
  const nodeTop = isPoint ? (minHeight - bh) / 2 : NODE_TOP;
  const nodeBottom = nodeTop + bh;
  const detail = detailFor(item);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // An ongoing row carries its elapsed time in the label so a screen reader
      // gets what the pill shows. Spelled with fmtDur ("1h 18m") rather than the
      // pill's column-constrained fmtAgoShort ("1h18m"), which reads badly aloud.
      accessibilityLabel={
        ongoing
          ? `Edit running ${ACTIVITY_LABEL[type]}${timer ? ' timer' : ''}, ${fmtDur(elapsedMin)} so far`
          : `Edit ${ACTIVITY_LABEL[type]}`
      }
      style={(s) => [
        // A faint full-bleed wash in the entry's own activity color, spanning the
        // whole row (width and height). Kept very light so the timeline spine and
        // text stay legible over it in both themes. ROW_PAD holds the content off
        // the edges the wash bleeds to; ROW_GAP spaces the rows apart.
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
      {/* clock column: newest-first, so the end sits at the capsule head and the
          start at its foot. Point events show their single time at the head. */}
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
              // No end to show, so the slot holds how long it has been running
              // instead. alignSelf right-aligns it on the start clock below it.
              // TIME_W is sized so even the widest label ("11h30m", the shape a
              // night-long timer takes before fmtAgoShort switches to days) fits
              // inside the row's ROW_PAD inset; a wider one would spill left
              // over that inset rather than be clipped.
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

      {/* content: icon + label │ detail on ONE line, vertically centered on the
          marker (its center is nodeTop + bh/2 for both dot and capsule). */}
      <View style={{ flex: 1, paddingLeft: 4, paddingTop: nodeTop + bh / 2 - CONTENT_H / 2, paddingBottom: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: CONTENT_H, height: CONTENT_H, borderRadius: 9, backgroundColor: hexA(color, 0.16), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={type as IconName} color={color} size={17} />
          </View>
          <Txt weight={700} size={16} tracking={-0.2}>
            {ACTIVITY_LABEL[type]}
          </Txt>
          {detail ? (
            <>
              <View style={{ width: 1, height: 18, backgroundColor: t.line }} />
              <Txt weight={500} size={14} color={t.dim} numberOfLines={1} style={{ flexShrink: 1 }}>
                {detail}
              </Txt>
            </>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
