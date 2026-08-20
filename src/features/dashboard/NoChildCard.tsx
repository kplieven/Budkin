import { View } from 'react-native';

import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Tappable } from '@/components/press';
import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { shadowStyle } from '@/theme/shadow';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

/** Shown in place of the dashboard when there is no child to log against: the
 *  first-run add-baby step was skipped or answered "not yet", or the last child was
 *  deleted. */
export function NoChildCard() {
  const t = useTheme();
  const openAddChild = useAppStore((s) => s.openAddChild);

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

      <Txt weight={800} size={19} tracking={-0.3} style={{ marginTop: 18 }}>
        No baby yet
      </Txt>
      <Txt weight={500} size={14.5} color={t.dim} style={{ marginTop: 8, textAlign: 'center', lineHeight: 21 }}>
        Budkin starts tracking feeds, naps, diapers and growth as soon as you add them.
      </Txt>

      <Tappable
        onPress={openAddChild}
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
        <Icon name="plus" color={t.onPrimary} size={18} />
        <Txt unselectable weight={800} size={16} color={t.onPrimary}>
          Add your baby
        </Txt>
      </Tappable>
    </View>
  );
}
