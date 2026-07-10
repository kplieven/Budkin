import { Pressable, View } from 'react-native';

import { isHovered } from '@/components/hover';
import { Icon, type IconName } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { ACTIVITY_LABEL } from '@/lib/activities';
import { hexA } from '@/lib/color';
import { fmtAgo, fmtClock } from '@/lib/format';
import { type Entry } from '@/types/models';
import { useTheme } from '@/theme/useTheme';
import { detailFor } from './detail';

/** A single activity entry row — icon chip + title + detail + time/ago. Shared by
 *  the History screen and the desktop timeline rail. */
export function ActivityRow({ entry, now, onPress }: { entry: Entry; now: number; onPress: () => void }) {
  const t = useTheme();
  // Duration activities show their START time; point events (diaper, bath,
  // temperature) show their single time.
  const ts =
    entry.type === 'diaper' || entry.type === 'bath' || entry.type === 'temperature'
      ? entry.time
      : entry.start;
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
