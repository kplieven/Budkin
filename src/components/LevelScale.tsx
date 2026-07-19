import { Pressable, View } from 'react-native';

import { isHovered } from '@/components/hover';
import { Txt } from '@/components/Txt';
import type { LevelSet } from '@/lib/activities';
import { useTheme } from '@/theme/useTheme';

interface LevelScaleProps {
  /** Which three-level scale this is: the labels plus how to read a stored
   *  number back as a level. See `DIAPER_LEVELS` / `INTAKE_LEVELS`. */
  levels: LevelSet;
  value?: number | null;
  color: string;
  onSelect: (n: number) => void;
}

/**
 * A row of three mutually exclusive level buttons, backed by an entry's numeric
 * `amount`. Shared by the solid diaper size and the breastfeeding intake, which
 * differ only in wording and in how they bucket a stored number.
 *
 * Selection is derived through `levels.bucket` rather than by exact equality so
 * a value the current scale never writes (an older wider-range score, or any
 * float Baby Buddy hands back) still lights a button up instead of showing an
 * empty row that silently discards what is on file.
 */
export function LevelScale({ levels, value, color, onSelect }: LevelScaleProps) {
  const t = useTheme();
  const selected = value == null || !Number.isFinite(value) ? null : levels.bucket(value);
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {levels.labels.map((label, i) => {
        const n = i + 1;
        const sel = selected === n;
        return (
          <Pressable
            key={label}
            onPress={() => onSelect(n)}
            accessibilityRole="button"
            accessibilityState={{ selected: sel }}
            style={(s) => [
              {
                flex: 1,
                height: 42,
                borderRadius: 10,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: sel ? color : t.chip,
                borderWidth: 1.5,
                borderColor: sel ? color : t.line,
                cursor: 'pointer',
              },
              !sel && isHovered(s) && { borderColor: t.line2 },
            ]}
          >
            <Txt unselectable weight={700} size={13.5} color={sel ? t.onActivity : t.text}>
              {label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
