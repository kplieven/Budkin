/**
 * Inline precise time/duration editor, the escape hatch from the quick chips.
 * Clock mode edits an absolute timestamp (digits-first smart parsing, no AM/PM
 * needed) with a day stepper for cross-midnight entries; duration mode edits
 * minutes. Controlled and pure: all state lives in the parent.
 */

import { useState } from 'react';
import { Pressable, TextInput, useWindowDimensions, View } from 'react-native';

import { DayPicker } from '@/components/DayPicker';
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
  const [calendar, setCalendar] = useState(false);

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

  // The six nudges share the row's free space rather than hugging a fixed padding.
  //
  // · flexGrow + flexBasis 'auto', NOT flex:1. flex:1 expands to flexBasis 0%, throwing away
  //   the intrinsic width and flattening all six to one size, which squeezes the wider
  //   "−15m"/"+15m" ink out over its padding.
  // · paddingHorizontal 2 is a MINIMUM, not the padding you see. It is this low only to lower
  //   the width at which the row wraps, which is what buys room for the "m".
  // · alignItems 'center' is not a no-op with one child: the default 'stretch' makes the Txt
  //   span the whole chip, left-aligning the ink once the chip grows wider than its text.
  // · maxWidth must scale with fontScale, because it clamps the flex BASE size and so binds
  //   BEFORE line breaking. Held flat it would stop the chip growing once the label outgrew
  //   it and paint the glyphs outside the border rather than letting the row wrap, which
  //   real users reach: Android a11y text goes to 2x and iOS Dynamic Type to about 3x.
  const stepBtn = {
    paddingHorizontal: 2,
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
    // No outer margin: spacing below is the parent's business. It used to carry
    // marginBottom 12 from when the Quick set strip always followed it; the strip
    // now leads its panel and this sits last, where that margin was dead space.
    <View style={{ backgroundColor: t.bg, borderWidth: 1.5, borderColor: t.line, borderRadius: 16, padding: 12, gap: 10 }}>
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

      <View style={{ flexDirection: 'row', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
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
          <Pressable
            onPress={() => {
              setText(null);
              setCalendar((c) => !c);
            }}
            accessibilityRole="button"
            accessibilityLabel={`${dayGroupLabel(value, now)}. Pick a date`}
            accessibilityState={{ expanded: calendar }}
            style={(s) => [
              {
                flex: 1,
                height: 38,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                backgroundColor: t.surface,
                borderWidth: 1.5,
                borderColor: calendar ? color : t.line,
                borderRadius: 11,
                cursor: 'pointer',
              },
              !calendar && isHovered(s) && { borderColor: t.line2 },
            ]}
          >
            <Txt unselectable weight={700} size={13.5}>
              {dayGroupLabel(value, now)}
            </Txt>
            <Icon name={calendar ? 'chevron-up' : 'chevron-down'} color={t.dim} size={15} />
          </Pressable>
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

      {mode === 'clock' && calendar && (
        // The rule keeps the month chevrons from reading as a second row of the
        // day stepper directly above them.
        <View style={{ borderTopWidth: 1.5, borderTopColor: t.line, paddingTop: 8 }}>
          <DayPicker value={value} now={now} color={color} onChange={onChange} />
        </View>
      )}
    </View>
  );
}
