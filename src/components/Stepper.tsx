import { Pressable, View } from 'react-native';

import { isHovered } from '@/components/hover';
import { Txt } from '@/components/Txt';
import { useTheme } from '@/theme/useTheme';
import { toDisplay, unitLabel, type UnitSystem } from '@/lib/units';

interface StepperProps {
  /** Canonical millilitres, as stored: imperial is a display lens only, so the
   *  caller keeps handing us ml and we relabel and convert here. */
  value: number;
  system: UnitSystem;
  onMinus: () => void;
  onPlus: () => void;
}

export function Stepper({ value, system, onMinus, onPlus }: StepperProps) {
  const t = useTheme();
  const unit = unitLabel('volume', system);
  const shown = toDisplay('volume', value, system);
  // Imperial steps by halves, so hold one decimal to keep 3.0 / 3.5 / 4.0 an even
  // column. Metric is whole millilitres, but an amount first entered in fl oz
  // converts back to a fraction, so trim that to one decimal as well.
  const text = system === 'imperial' ? shown.toFixed(1) : String(Math.round(shown * 10) / 10);
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
        <Txt unselectable weight={700} size={26} color={t.text}>
          −
        </Txt>
      </Pressable>
      <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'baseline' }}>
        <Txt weight={800} size={24} style={{ fontVariant: ['tabular-nums'] }}>
          {text}
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
        <Txt unselectable weight={700} size={26} color={t.text}>
          +
        </Txt>
      </Pressable>
    </View>
  );
}
