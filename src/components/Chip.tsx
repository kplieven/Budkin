import { Pressable, View } from 'react-native';

import { isHovered } from '@/components/hover';
import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { useTheme } from '@/theme/useTheme';

interface ChipProps {
  label: string;
  /** activity color used when selected */
  color: string;
  selected?: boolean;
  onPress?: () => void;
  /** leading swatch dot color (diaper colors) */
  swatch?: string;
  /** dashed primary-tinted action chip (e.g. "Start live timer") */
  dashed?: boolean;
  padH?: number;
  padV?: number;
  radius?: number;
  fontSize?: number;
}

export function Chip({
  label,
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
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
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
        <Txt weight={700} size={fontSize} color={t.primary}>
          {label}
        </Txt>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
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
      <Txt weight={700} size={fontSize} color={selected ? t.onActivity : t.text}>
        {label}
      </Txt>
    </Pressable>
  );
}
