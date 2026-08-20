import { View } from 'react-native';

import { isHovered } from '@/components/hover';
import { Tappable } from '@/components/press';
import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { useTheme } from '@/theme/useTheme';

interface ChipProps {
  label: string;
  /** Spoken instead of `label` when the visible text is an abbreviation a
   *  screen reader would mangle ("3h" reads as "three h"). */
  accessibilityLabel?: string;
  /** activity color used when selected */
  color: string;
  selected?: boolean;
  onPress?: () => void;
  /** leading swatch dot color (diaper colors) */
  swatch?: string;
  dashed?: boolean;
  padH?: number;
  padV?: number;
  radius?: number;
  fontSize?: number;
}

export function Chip({
  label,
  accessibilityLabel,
  color,
  selected = false,
  onPress,
  swatch,
  dashed = false,
  padH = 15,
  padV = 10,
  radius = 13,
  fontSize = 14,
}: ChipProps) {
  const t = useTheme();

  if (dashed) {
    return (
      <Tappable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ selected }}
        style={(s) => [
          {
            paddingHorizontal: padH,
            paddingVertical: padV,
            borderRadius: radius,
            backgroundColor: hexA(t.primary, t.dark ? 0.1 : 0.07),
            borderWidth: 1.5,
            borderColor: hexA(t.primary, 0.5),
            borderStyle: 'dashed' as const,
            flexDirection: 'row' as const,
            alignItems: 'center' as const,
            gap: 7,
            cursor: 'pointer' as const,
          },
          isHovered(s) && { backgroundColor: hexA(t.primary, t.dark ? 0.16 : 0.12) },
        ]}
      >
        <Txt unselectable weight={700} size={fontSize} color={t.primary}>
          {label}
        </Txt>
      </Tappable>
    );
  }

  return (
    <Tappable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      style={(s) => [
        {
          paddingHorizontal: padH,
          paddingVertical: padV,
          borderRadius: radius,
          backgroundColor: selected ? color : t.chip,
          borderWidth: 1.5,
          borderColor: selected ? color : t.line,
          flexDirection: 'row' as const,
          alignItems: 'center' as const,
          gap: 7,
          cursor: 'pointer' as const,
        },
        !selected && isHovered(s) && { borderColor: t.line2 },
      ]}
    >
      {swatch && (
        <View
          style={{
            width: 14,
            height: 14,
            borderRadius: 99,
            backgroundColor: swatch,
            borderWidth: 1,
            borderColor: t.line2,
          }}
        />
      )}
      <Txt unselectable weight={700} size={fontSize} color={selected ? t.onActivity : t.text}>
        {label}
      </Txt>
    </Tappable>
  );
}
