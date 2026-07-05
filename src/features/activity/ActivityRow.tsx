import { Pressable, View } from 'react-native';

import { isHovered } from '@/components/hover';
import { Icon, type IconName } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { ACTIVITY_LABEL } from '@/lib/activities';
import { hexA } from '@/lib/color';
import { fmtAgo, fmtClock, fmtDur } from '@/lib/format';
import { type Entry } from '@/types/models';
import { useTheme } from '@/theme/useTheme';

const FEED_TYPE_LABEL: Record<string, string> = {
  breast: 'Breast milk',
  formula: 'Formula',
  fortified: 'Fortified',
  solid: 'Solid food',
};
const FEED_METHOD_LABEL: Record<string, string> = {
  left: 'left breast',
  right: 'right breast',
  both: 'both',
  bottle: 'bottle',
  parent: 'parent fed',
  self: 'self fed',
};

/** One-line summary of an entry, by activity type. */
function detailFor(e: Entry): string {
  switch (e.type) {
    case 'feeding':
      return [
        FEED_TYPE_LABEL[e.feedType] ?? '',
        FEED_METHOD_LABEL[e.method] ?? '',
        e.amount ? `${e.amount}ml` : '',
        e.end ? fmtDur((e.end - e.start) / 60000) : '',
      ]
        .filter(Boolean)
        .join(' · ');
    case 'sleep':
      return (e.nap ? 'Nap' : 'Night') + (e.end ? ' · ' + fmtDur((e.end - e.start) / 60000) : ' · ongoing');
    case 'diaper':
      return [e.wet ? 'Wet' : '', e.solid ? 'Solid' : '', e.color ?? ''].filter(Boolean).join(' · ') || 'Dry';
    case 'pumping':
      return [e.amount ? `${e.amount}ml` : '', e.end ? fmtDur((e.end - e.start) / 60000) : ''].filter(Boolean).join(' · ');
    case 'tummy':
      return [e.end ? fmtDur((e.end - e.start) / 60000) : '', e.milestone ?? ''].filter(Boolean).join(' · ');
  }
}

/** A single activity entry row — icon chip + title + detail + time/ago. Shared by
 *  the History screen and the desktop timeline rail. */
export function ActivityRow({ entry, now, onPress }: { entry: Entry; now: number; onPress: () => void }) {
  const t = useTheme();
  // Duration activities show their START time; diaper is a point event (time).
  const ts = entry.type === 'diaper' ? entry.time : entry.start;
  const color = t.activity[entry.type];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={(s) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 13,
          paddingHorizontal: 14,
          backgroundColor: t.surface,
          borderWidth: 1.5,
          borderColor: t.line,
          borderRadius: 18,
          cursor: 'pointer',
        },
        isHovered(s) && { borderColor: hexA(color, 0.5) },
      ]}
    >
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: hexA(color, 0.16), alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={entry.type as IconName} color={color} size={21} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt weight={700} size={15.5} tracking={-0.2}>
          {ACTIVITY_LABEL[entry.type]}
        </Txt>
        <Txt weight={500} size={13} color={t.dim} style={{ marginTop: 1 }} numberOfLines={1}>
          {detailFor(entry)}
        </Txt>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Txt weight={600} size={14} style={{ fontVariant: ['tabular-nums'] }}>
          {fmtClock(ts)}
        </Txt>
        <Txt weight={500} size={12} color={t.faint} style={{ marginTop: 1 }}>
          {fmtAgo(ts, now)}
        </Txt>
      </View>
    </Pressable>
  );
}
