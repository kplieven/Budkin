import type { ViewStyle } from 'react-native';

import { isHovered } from '@/components/hover';
import { Tappable } from '@/components/press';
import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { shadowStyle } from '@/theme/shadow';
import { useTheme } from '@/theme/useTheme';

/** The setup wizard's button, shared by both wizard screens so the steps stay visually
 *  identical. */
export function SetupButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const t = useTheme();
  const primary = variant === 'primary';

  return (
    <Tappable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={(s) => [
        {
          height: 56,
          borderRadius: 17,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: primary ? t.primary : t.surface,
          borderWidth: primary ? 0 : 1.5,
          borderColor: t.line2,
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'auto' : 'pointer',
        },
        primary && !disabled && shadowStyle(`0px 8px 22px ${hexA(t.primary, 0.35)}`),
        !disabled && isHovered(s) && (primary ? { opacity: 0.9 } : { borderColor: t.line }),
        style,
      ]}
    >
      <Txt
        unselectable
        weight={primary ? 800 : 700}
        size={primary ? 17 : 16}
        color={primary ? t.onPrimary : t.text}
      >
        {label}
      </Txt>
    </Tappable>
  );
}
