/**
 * Inline precise time/duration editor — the escape hatch from the quick chips.
 *
 * Clock mode edits an absolute timestamp: a type-able clock value (digits-first
 * smart parsing, no AM/PM needed), ±1/5/15m step chips, and a day stepper for
 * cross-midnight entries. Duration mode edits minutes the same way.
 * Controlled and pure: all state lives in the parent via value/onChange.
 */

import { useState } from 'react';
import { Pressable, TextInput, useWindowDimensions, View } from 'react-native';

import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { dayGroupLabel, fmtAgo, fmtClock, fmtDur } from '@/lib/format';
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
  /** clock mode only: show a live "45m ago" caption under the input */
  showRelative?: boolean;
}

export function TimeAdjuster({ mode, value, now, color, onChange, showRelative = false }: TimeAdjusterProps) {
  const t = useTheme();
  // Only for the nudge cap below. react-native-web pins this to 1, so web layout is unaffected.
  const { fontScale } = useWindowDimensions();
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

  // The six nudges share the row's free space instead of hugging a 320dp-sized padding.
  //
  // · flexGrow + flexBasis 'auto', deliberately NOT flex:1. flex:1 expands to flexBasis 0%,
  //   which throws away the intrinsic width and flattens all six to one size, squeezing the
  //   wider "−15"/"+15" ink out over its padding. 'auto' keeps each label's own width as the
  //   floor, so the wide ones stay wide and every chip takes an equal share of the slack.
  // · alignItems 'center' is not a no-op just because the Pressable has one child: the default
  //   'stretch' makes that Txt span the whole chip, which left-aligns the ink the moment the
  //   chip grows wider than its text.
  // · maxWidth caps the tap target so a wide row gives chips, not buttons, and so a lone chip
  //   is still chip-sized if the row takes its flexWrap escape hatch. 56 sits just above the
  //   47px widest chip in the Timers "Started earlier?" row, which is the geometry this row is
  //   meant to match. It must scale with fontScale: maxWidth clamps the flex BASE size, so it
  //   binds BEFORE line breaking. Held at a flat 56 it would stop the chip growing once the
  //   label outgrew it and paint the glyphs outside the border, instead of letting the row wrap
  //   (reachable for real users: Android a11y text reaches 2x, iOS Dynamic Type about 3x, and
  //   nothing here passes allowFontScaling={false}). Scaling the cap keeps it binding at 1x and
  //   lets it step aside when the text is large.
  const stepBtn = {
    paddingHorizontal: 4,
    paddingVertical: 8,
    alignItems: 'center' as const,
    flexGrow: 1,
    flexBasis: 'auto' as const,
    maxWidth: 56 * fontScale,
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
      {showRelative && mode === 'clock' && (
        <Txt weight={600} size={12.5} color={t.dim} style={{ textAlign: 'center', marginTop: -2 }}>
          {fmtAgo(value, now)}
        </Txt>
      )}

      <View style={{ flexDirection: 'row', gap: 5, justifyContent: 'center', flexWrap: 'wrap' }}>
        {STEPS.map((d) => (
          <Pressable
            key={d}
            onPress={() => step(d)}
            accessibilityRole="button"
            accessibilityLabel={d > 0 ? `Add ${d} minutes` : `Subtract ${-d} minutes`}
            style={(s) => [stepBtn, isHovered(s) && { backgroundColor: t.elevated }]}
          >
            <Txt weight={700} size={13} style={{ fontVariant: ['tabular-nums'] }}>
              {d > 0 ? `+${d}` : `−${-d}`}
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
