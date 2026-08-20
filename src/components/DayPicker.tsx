/**
 * Inline month calendar for jumping an entry's date somewhere the day chevrons
 * would take a lot of tapping to reach. Controlled and pure like the rest of the
 * time editor: it holds only the month it is showing, and reports a whole
 * timestamp — the picked day carrying the value's existing time of day.
 */

import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { addMonths, monthGrid, monthLabel, startOfDay, startOfMonth, WEEKDAY_INITIALS, withDate } from '@/lib/calendarMonth';
import { hexA } from '@/lib/color';
import { useTheme } from '@/theme/useTheme';

const WEEKS = [0, 1, 2, 3, 4, 5];

interface DayPickerProps {
  /** the timestamp being edited: its day is selected, its time of day is kept */
  value: number;
  now: number;
  color: string;
  onChange: (ms: number) => void;
}

export function DayPicker({ value, now, color, onChange }: DayPickerProps) {
  const t = useTheme();
  const [month, setMonth] = useState(() => startOfMonth(value));
  const selected = startOfDay(value);

  // Re-anchor when the day moves under us (the chevrons, the anchor chips and the
  // text input all write `value`), adjusting state during render rather than in an
  // effect so the grid never paints a frame on the old month.
  //
  // Compares DAYS, not timestamps: a relative value ("18m ago") is recomputed off a
  // store clock that ticks every second, and re-anchoring on that would snap the
  // month back to today's while you were paging through last spring.
  const [seen, setSeen] = useState(selected);
  if (selected !== seen) {
    setSeen(selected);
    setMonth(startOfMonth(selected));
  }

  const today = startOfDay(now);
  const atCurrentMonth = month >= startOfMonth(now);

  const navBtn = {
    width: 38,
    height: 34,
    borderRadius: 10,
    backgroundColor: t.chip,
    borderWidth: 1.5,
    borderColor: t.line,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };

  const cells = monthGrid(month);

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable
          onPress={() => setMonth(addMonths(month, -1))}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          style={(s) => [navBtn, { cursor: 'pointer' }, isHovered(s) && { backgroundColor: t.elevated }]}
        >
          <Icon name="chevron-left" color={t.text} size={16} />
        </Pressable>
        <Txt unselectable weight={700} size={13.5} style={{ flex: 1, textAlign: 'center' }}>
          {monthLabel(month)}
        </Txt>
        <Pressable
          onPress={() => setMonth(addMonths(month, 1))}
          disabled={atCurrentMonth}
          accessibilityRole="button"
          accessibilityLabel="Next month"
          accessibilityState={{ disabled: atCurrentMonth }}
          style={(s) => [
            navBtn,
            { opacity: atCurrentMonth ? 0.4 : 1, cursor: atCurrentMonth ? 'auto' : 'pointer' },
            !atCurrentMonth && isHovered(s) && { backgroundColor: t.elevated },
          ]}
        >
          <Icon name="chevron-right" color={t.text} size={16} />
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row' }}>
        {WEEKDAY_INITIALS.map((w, i) => (
          <Txt key={i} unselectable weight={700} size={11} color={t.faint} style={{ flex: 1, textAlign: 'center' }}>
            {w}
          </Txt>
        ))}
      </View>

      {WEEKS.map((w) => (
        <View key={w} style={{ flexDirection: 'row', gap: 4 }}>
          {cells.slice(w * 7, w * 7 + 7).map((c) => {
            const isSelected = c.ms === selected;
            const isToday = c.ms === today;
            const future = c.ms > today;
            return (
              <Pressable
                key={c.ms}
                onPress={() => onChange(Math.min(now, withDate(value, c.ms)))}
                disabled={future}
                accessibilityRole="button"
                accessibilityLabel={`${c.day} ${monthLabel(c.ms)}`}
                accessibilityState={{ selected: isSelected, disabled: future }}
                style={(s) => [
                  {
                    flex: 1,
                    height: 32,
                    borderRadius: 9,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: isSelected ? color : 'transparent',
                    borderWidth: 1.5,
                    borderColor: isToday && !isSelected ? hexA(color, 0.55) : 'transparent',
                    opacity: future ? 0.3 : 1,
                    cursor: future ? 'auto' : 'pointer',
                  },
                  !future && !isSelected && isHovered(s) && { backgroundColor: t.chip },
                ]}
              >
                <Txt
                  unselectable
                  weight={isSelected || isToday ? 800 : 500}
                  size={13}
                  color={isSelected ? t.onActivity : c.inMonth ? t.text : t.faint}
                  style={{ fontVariant: ['tabular-nums'] }}
                >
                  {c.day}
                </Txt>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
