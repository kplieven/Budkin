import { Pressable, View } from 'react-native';

import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { useTheme } from '@/theme/useTheme';
import type { MilestoneDef } from '@/lib/milestones';

function reachedDateLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function MilestoneRow({
  def,
  reachedAt,
  onPress,
}: {
  def: MilestoneDef;
  /** epoch ms if reached, else null */
  reachedAt: number | null;
  onPress: () => void;
}) {
  const t = useTheme();
  const color = t.activity.note;
  const reached = reachedAt != null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ checked: reached }}
      accessibilityLabel={reached ? `${def.title}, reached` : `${def.title}, not yet reached`}
      style={(s) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 12,
          paddingHorizontal: 14,
          backgroundColor: t.surface,
          borderWidth: 1.5,
          borderColor: reached ? hexA(color, 0.4) : t.line,
          borderRadius: 16,
          cursor: 'pointer',
        },
        isHovered(s) && { borderColor: hexA(color, 0.6) },
      ]}
    >
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 999,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: reached ? color : 'transparent',
          borderWidth: reached ? 0 : 2,
          borderColor: t.line2,
        }}
      >
        {reached ? <Icon name="check" color={t.onActivity} size={16} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Txt weight={700} size={15} color={t.text}>
          {def.title}
        </Txt>
        <Txt weight={500} size={12.5} color={t.faint} style={{ marginTop: 1 }}>
          {reached ? reachedDateLabel(reachedAt as number) : `typically ${def.minMonths} to ${def.maxMonths} months`}
        </Txt>
      </View>
    </Pressable>
  );
}
