/**
 * Inline precise time/duration editor — the escape hatch from the quick chips.
 *
 * Clock mode edits an absolute timestamp: a type-able clock value (digits-first
 * smart parsing, no AM/PM needed), ±1/5/15m step chips, and a day stepper for
 * cross-midnight entries. Duration mode edits minutes the same way.
 * Controlled and pure: all state lives in the parent via value/onChange.
 */

import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { dayGroupLabel, fmtClock, fmtDur } from '@/lib/format';
import { parseClockInput, parseDurationInput, resolveClock } from '@/lib/timeParse';
import { fontFamily } from '@/theme/fonts';
import { useTheme } from '@/theme/useTheme';

const DAY = 86400000;
const STEPS = [-15, -5, -1, 1, 5, 15];

interface TimeAdjusterProps {
  mode: 'clock' | 'duration';
  /** clock: absolute ms · duration: minutes */
  value: number;
  now: number;
  /** activity accent color */
  color: string;
  onChange: (v: number) => void;
}

export function TimeAdjuster({ mode, value, now, color, onChange }: TimeAdjusterProps) {
  const t = useTheme();
  const [text, setText] = useState<string | null>(null); // null = not editing

  const display = mode === 'clock' ? fmtClock(value) : fmtDur(value);

  const commitText = (raw: string) => {
    setText(null);
    if (!raw.trim()) return;
    if (mode === 'clock') {
      const parsed = parseClockInput(raw);
      if (parsed) onChange(resolveClock(parsed, value, now));
    } else {
      const min = parseDurationInput(raw);
      if (min != null) onChange(min);
    }
  };

  const step = (deltaMin: number) => {
    setText(null);
    if (mode === 'clock') onChange(Math.min(now, value + deltaMin * 60000));
    else onChange(Math.max(1, value + deltaMin));
  };

  // day stepper (clock mode): keep the time-of-day, move whole days
  const stepDay = (dir: -1 | 1) => {
    setText(null);
    onChange(Math.min(now, value + dir * DAY));
  };
  const isToday = new Date(value).toDateString() === new Date(now).toDateString();

  const stepBtn = {
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 11,
    backgroundColor: t.chip,
    borderWidth: 1.5,
    borderColor: t.line,
    cursor: 'pointer' as const,
  };

  return (
    <View style={{ backgroundColor: t.bg, borderWidth: 1.5, borderColor: t.line, borderRadius: 16, padding: 12, gap: 10, marginBottom: 12 }}>
      <TextInput
        value={text ?? display}
        onFocus={() => setText('')}
        onChangeText={setText}
        onBlur={() => text != null && commitText(text)}
        onSubmitEditing={() => text != null && commitText(text)}
        placeholder={display}
        placeholderTextColor={t.faint}
        inputMode="numeric"
        keyboardType="number-pad"
        returnKeyType="done"
        selectTextOnFocus
        style={{
          height: 46,
          borderRadius: 12,
          backgroundColor: t.surface,
          borderWidth: 1.5,
          borderColor: text != null ? color : t.line,
          textAlign: 'center',
          fontSize: 22,
          fontFamily: fontFamily(800),
          fontVariant: ['tabular-nums'],
          color: t.text,
        }}
      />

      <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
        {STEPS.map((d) => (
          <Pressable
            key={d}
            onPress={() => step(d)}
            accessibilityRole="button"
            accessibilityLabel={d > 0 ? `Add ${d} minutes` : `Subtract ${-d} minutes`}
            style={(s) => [stepBtn, isHovered(s) && { backgroundColor: t.elevated }]}
          >
            <Txt weight={700} size={13} style={{ fontVariant: ['tabular-nums'] }}>
              {d > 0 ? `+${d}m` : `−${-d}m`}
            </Txt>
          </Pressable>
        ))}
      </View>

      {mode === 'clock' && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable
            onPress={() => stepDay(-1)}
            accessibilityRole="button"
            accessibilityLabel="Previous day"
            style={(s) => [
              { width: 40, height: 38, borderRadius: 11, backgroundColor: t.chip, borderWidth: 1.5, borderColor: t.line, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
              isHovered(s) && { backgroundColor: t.elevated },
            ]}
          >
            <Icon name="chevron-left" color={t.text} size={18} />
          </Pressable>
          <View style={{ flex: 1, height: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, borderRadius: 11 }}>
            <Txt weight={700} size={13.5}>
              {dayGroupLabel(value, now)}
            </Txt>
          </View>
          <Pressable
            onPress={() => stepDay(1)}
            disabled={isToday}
            accessibilityRole="button"
            accessibilityLabel="Next day"
            accessibilityState={{ disabled: isToday }}
            style={(s) => [
              {
                width: 40,
                height: 38,
                borderRadius: 11,
                backgroundColor: t.chip,
                borderWidth: 1.5,
                borderColor: t.line,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: isToday ? 0.4 : 1,
                cursor: isToday ? 'auto' : 'pointer',
              },
              !isToday && isHovered(s) && { backgroundColor: t.elevated },
            ]}
          >
            <Icon name="chevron-right" color={t.text} size={18} />
          </Pressable>
        </View>
      )}
    </View>
  );
}
