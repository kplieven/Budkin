import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { noFocusRing } from '@/components/focusRing';
import { isHovered } from '@/components/hover';
import { Tappable } from '@/components/press';
import { Txt } from '@/components/Txt';
import { fontFamily } from '@/theme/fonts';
import { useTheme } from '@/theme/useTheme';
import { fmtValue, unitLabel, type UnitSystem } from '@/lib/units';

interface StepperProps {
  /** The amount as stored, already in the user's units: `system` only picks the label. */
  value: number;
  system: UnitSystem;
  onMinus: () => void;
  onPlus: () => void;
  /** Typed-in amount, as typed. */
  onChange: (amount: number) => void;
  /** The activity's accent, used for the focus border while typing. */
  color: string;
}

export function Stepper({ value, system, onMinus, onPlus, onChange, color }: StepperProps) {
  const t = useTheme();
  const [text, setText] = useState<string | null>(null); // null = not editing
  const unit = unitLabel('volume', system);
  // Imperial steps by halves, so hold one decimal to keep 3.0 / 3.5 / 4.0 an even
  // column; anything finer, such as a typed 3.25, shows in full.
  const display =
    system === 'imperial' && Number.isInteger(value * 10) ? value.toFixed(1) : fmtValue(value);

  // The ± buttons are the fast path but a poor one for a 137 ml bottle, so the
  // reading itself is an input: tap it and type the amount in the shown unit.
  // Blank or unparseable text leaves the value alone, matching TimeAdjuster.
  const commit = (raw: string) => {
    setText(null);
    const v = parseFloat(raw.replace(',', '.'));
    if (Number.isNaN(v)) return;
    onChange(Math.max(0, v));
  };

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
        borderColor: text != null ? color : t.line,
        borderRadius: 16,
        padding: 8,
      }}
    >
      <Tappable
        onPress={onMinus}
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${unit}`}
        style={(s) => [btn, isHovered(s) && { backgroundColor: t.elevated }]}
      >
        <Txt unselectable weight={700} size={26} color={t.text}>
          −
        </Txt>
      </Tappable>
      {text == null ? (
        <Tappable
          onPress={() => setText('')}
          accessibilityRole="button"
          accessibilityLabel={`Amount ${display} ${unit}. Tap to type`}
          style={{ flex: 1, height: 48, justifyContent: 'center', cursor: 'pointer' }}
        >
          {/* The baseline row needs its own box. Baseline alignment pins the text to
            * the TOP of whatever box it is in, so putting it straight on a
            * full-height tap target rides the number up off the centre line. */}
          <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'baseline' }}>
            <Txt unselectable weight={800} size={24} style={{ fontVariant: ['tabular-nums'] }}>
              {display}
            </Txt>
            <Txt unselectable weight={600} size={14} color={t.dim} style={{ marginLeft: 3 }}>
              {unit}
            </Txt>
          </View>
        </Tappable>
      ) : (
        <TextInput
          autoFocus
          value={text}
          onChangeText={setText}
          onBlur={() => text != null && commit(text)}
          onSubmitEditing={() => text != null && commit(text)}
          placeholder={display}
          placeholderTextColor={t.faint}
          inputMode="decimal"
          keyboardType="decimal-pad"
          returnKeyType="done"
          accessibilityLabel={`Amount in ${unit}`}
          style={{
            flex: 1,
            // Without it the web <input>'s intrinsic size wins the row's min-width
            // and shoulders the + button out of the frame.
            minWidth: 0,
            height: 48,
            textAlign: 'center',
            fontSize: 24,
            fontFamily: fontFamily(800),
            fontVariant: ['tabular-nums'],
            color: t.text,
            ...noFocusRing,
          }}
        />
      )}
      <Tappable
        onPress={onPlus}
        accessibilityRole="button"
        accessibilityLabel={`Increase ${unit}`}
        style={(s) => [btn, isHovered(s) && { backgroundColor: t.elevated }]}
      >
        <Txt unselectable weight={700} size={26} color={t.text}>
          +
        </Txt>
      </Tappable>
    </View>
  );
}
