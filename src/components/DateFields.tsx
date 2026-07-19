import { TextInput, View } from 'react-native';

import { fontFamily } from '@/theme/fonts';
import { useTheme } from '@/theme/useTheme';

/**
 * A DD / MM / YYYY input row. Extracted so the wizard's born and expecting
 * branches and the confirm-birth sheet cannot drift apart.
 *
 * Each input is wrapped in a View that carries the flex sizing, and that is
 * load-bearing: a TextInput left as a DIRECT flex item keeps min-width: auto on
 * react-native-web, which pins it to its intrinsic width (~20 characters) and
 * overflows the row, pushing the year field off screen. Setting minWidth on the
 * TextInput itself does not help, because RNW drops it there. This bug shipped
 * once already. Keeping the workaround in one component is the point.
 */
export function DateFields({
  day,
  month,
  year,
  onDay,
  onMonth,
  onYear,
}: {
  day: string;
  month: string;
  year: string;
  onDay: (v: string) => void;
  onMonth: (v: string) => void;
  onYear: (v: string) => void;
}) {
  const t = useTheme();

  const field = {
    height: 54,
    borderRadius: 15,
    backgroundColor: t.surface,
    borderWidth: 1.5,
    borderColor: t.line2,
    paddingHorizontal: 16,
    fontSize: 15.5,
    fontFamily: fontFamily(500),
    color: t.text,
    width: '100%',
    textAlign: 'center',
  } as const;

  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <TextInput
          value={day}
          onChangeText={onDay}
          placeholder="DD"
          placeholderTextColor={t.faint}
          keyboardType="number-pad"
          maxLength={2}
          style={field}
        />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <TextInput
          value={month}
          onChangeText={onMonth}
          placeholder="MM"
          placeholderTextColor={t.faint}
          keyboardType="number-pad"
          maxLength={2}
          style={field}
        />
      </View>
      <View style={{ flex: 1.4, minWidth: 0 }}>
        <TextInput
          value={year}
          onChangeText={onYear}
          placeholder="YYYY"
          placeholderTextColor={t.faint}
          keyboardType="number-pad"
          maxLength={4}
          style={field}
        />
      </View>
    </View>
  );
}
