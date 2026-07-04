import { Pressable, View } from 'react-native';

import { isHovered } from '@/components/hover';
import { Txt } from '@/components/Txt';
import { useTheme } from '@/theme/useTheme';

interface StepperProps {
  value: number;
  unit?: string;
  onMinus: () => void;
  onPlus: () => void;
}

export function Stepper({ value, unit = 'ml', onMinus, onPlus }: StepperProps) {
  const t = useTheme();
  const btn = {
    width: 54,
    height: 48,
    borderRadius: 12,
    backgroundColor: t.chip,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    cursor: 'pointer' as const,
  };
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: t.surface,
        borderWidth: 1.5,
        borderColor: t.line,
        borderRadius: 16,
        padding: 8,
      }}
    >
      <Pressable
        onPress={onMinus}
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${unit}`}
        style={(s) => [btn, isHovered(s) && { backgroundColor: t.elevated }]}
      >
        <Txt weight={700} size={26} color={t.text}>
          −
        </Txt>
      </Pressable>
      <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'baseline' }}>
        <Txt weight={800} size={24} style={{ fontVariant: ['tabular-nums'] }}>
          {value}
        </Txt>
        <Txt weight={600} size={14} color={t.dim} style={{ marginLeft: 3 }}>
          {unit}
        </Txt>
      </View>
      <Pressable
        onPress={onPlus}
        accessibilityRole="button"
        accessibilityLabel={`Increase ${unit}`}
        style={(s) => [btn, isHovered(s) && { backgroundColor: t.elevated }]}
      >
        <Txt weight={700} size={26} color={t.text}>
          +
        </Txt>
      </Pressable>
    </View>
  );
}
