import { View } from 'react-native';

import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Tappable } from '@/components/press';
import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { ageOrDueLabel } from '@/lib/format';
import { shadowStyle } from '@/theme/shadow';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';
import type { Child } from '@/types/models';

/**
 * Shown in place of the dashboard while the selected child is still expected. The
 * activity tiles are deliberately absent: a feed or a nap logged against an unborn
 * baby is junk data, and hiding the tiles prevents it rather than discouraging it.
 */
export function ExpectingCard({ child }: { child: Child }) {
  const t = useTheme();
  const now = useAppStore((s) => s.now);
  const openConfirmBirth = useAppStore((s) => s.openConfirmBirth);

  return (
    <View
      style={{
        alignItems: 'center',
        paddingVertical: 40,
        paddingHorizontal: 24,
        borderRadius: 20,
        backgroundColor: t.surface,
        borderWidth: 1.5,
        borderColor: t.line2,
      }}
    >
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 18,
          backgroundColor: hexA(t.primary, t.dark ? 0.16 : 0.12),
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="heart" color={t.primary} size={26} />
      </View>

      <Txt weight={800} size={22} tracking={-0.4} style={{ marginTop: 18 }}>
        {ageOrDueLabel(child.birth, true, now)}
      </Txt>
      <Txt weight={500} size={14.5} color={t.dim} style={{ marginTop: 8, textAlign: 'center', lineHeight: 21 }}>
        Everything is ready for {child.first}. Tracking starts the day they arrive.
      </Txt>

      <Tappable
        onPress={() => openConfirmBirth(child.id)}
        accessibilityRole="button"
        style={(s) => [
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            height: 50,
            paddingHorizontal: 22,
            borderRadius: 15,
            marginTop: 22,
            backgroundColor: t.primary,
            cursor: 'pointer',
          },
          shadowStyle(`0px 8px 22px ${hexA(t.primary, 0.35)}`),
          isHovered(s) && { opacity: 0.9 },
        ]}
      >
        <Icon name="heart" color={t.onPrimary} size={18} />
        <Txt unselectable weight={800} size={16} color={t.onPrimary}>
          They have arrived
        </Txt>
      </Tappable>
    </View>
  );
}
