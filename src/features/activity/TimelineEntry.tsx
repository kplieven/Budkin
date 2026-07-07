import { Pressable, View } from 'react-native';

import { isHovered } from '@/components/hover';
import { Icon, type IconName } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { ACTIVITY_LABEL } from '@/lib/activities';
import { hexA } from '@/lib/color';
import { fmtClock } from '@/lib/format';
import { type Entry } from '@/types/models';
import { useTheme } from '@/theme/useTheme';
import { detailFor } from './detail';

const RAIL_W = 26;   // width of the spine column
const TIME_W = 46;   // width of the clock column
const NODE_TOP = 15; // vertical offset of the node/capsule from the entry top
const DOT = 12;      // point-event marker diameter
const CAP_W = 8;     // duration-capsule width

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
 * One event on the History timeline: a continuous spine on the left with a
 * marker (a dot for point events like diapers, a duration capsule for intervals
 * like sleep/feeds). The list runs newest-first, so an interval's newer edge
 * (its end) sits at the capsule head and its start at the foot — the gap between
 * the two clock labels reads as the event's real span. `isFirst`/`isLast` trim
 * the spine so it doesn't overhang a day group.
 */
export function TimelineEntry({ entry, now, onPress, isFirst, isLast }: {
  entry: Entry; now: number; onPress: () => void; isFirst: boolean; isLast: boolean;
}) {
  const t = useTheme();
  const color = t.activity[entry.type];
  const isPoint = entry.type === 'diaper';
  const start = entry.type === 'diaper' ? entry.time : entry.start;
  const endTs = entry.type === 'diaper' ? null : entry.end;
  const ongoing = !isPoint && endTs == null;

  const durMin = isPoint ? 0 : ((endTs ?? now) - start) / 60000;
  const bh = isPoint ? DOT : barHeight(durMin);
  const nodeBottom = NODE_TOP + bh;
  const minHeight = Math.max(58, nodeBottom + 16);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Edit ${ACTIVITY_LABEL[entry.type]}`}
      style={(s) => [{ flexDirection: 'row', minHeight, cursor: 'pointer' }, isHovered(s) && { opacity: 0.85 }]}
    >
      {/* clock column: newest-first, so the end sits at the capsule head and the
          start at its foot. Point events show their single time at the head. */}
      <View style={{ width: TIME_W, paddingRight: 8 }}>
        {isPoint ? (
          <View style={{ position: 'absolute', right: 8, top: NODE_TOP, height: DOT, justifyContent: 'center' }}>
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
            ) : null}
            <Txt weight={600} size={13.5} style={{ position: 'absolute', right: 8, top: nodeBottom - 7, fontVariant: ['tabular-nums'], textAlign: 'right' }}>
              {fmtClock(start)}
            </Txt>
          </>
        )}
      </View>

      {/* spine + marker */}
      <View style={{ width: RAIL_W }}>
        {!isFirst ? (
          <View style={{ position: 'absolute', top: 0, height: NODE_TOP, left: RAIL_W / 2 - 1, width: 2, backgroundColor: t.line }} />
        ) : null}
        {!isLast ? (
          <View style={{ position: 'absolute', top: nodeBottom, bottom: 0, left: RAIL_W / 2 - 1, width: 2, backgroundColor: t.line }} />
        ) : null}
        {isPoint ? (
          <View style={{ position: 'absolute', top: NODE_TOP, left: RAIL_W / 2 - DOT / 2, width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: color, borderWidth: 2.5, borderColor: t.bg }} />
        ) : (
          <View style={{ position: 'absolute', top: NODE_TOP, left: RAIL_W / 2 - CAP_W / 2, width: CAP_W, height: bh, borderRadius: CAP_W / 2, backgroundColor: ongoing ? hexA(color, 0.45) : color }} />
        )}
      </View>

      {/* content */}
      <View style={{ flex: 1, paddingLeft: 4, paddingTop: NODE_TOP - 8, paddingBottom: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: hexA(color, 0.16), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={entry.type as IconName} color={color} size={17} />
          </View>
          <Txt weight={700} size={15} tracking={-0.2}>
            {ACTIVITY_LABEL[entry.type]}
          </Txt>
        </View>
        <Txt weight={500} size={13} color={t.dim} numberOfLines={1} style={{ marginTop: 4 }}>
          {detailFor(entry)}
        </Txt>
      </View>
    </Pressable>
  );
}
