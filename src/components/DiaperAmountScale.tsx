import { Pressable, View } from 'react-native';

import { isHovered } from '@/components/hover';
import { Txt } from '@/components/Txt';
import { useTheme } from '@/theme/useTheme';

interface DiaperAmountScaleProps {
  value?: number | null;
  color: string;
  onSelect: (n: number) => void;
}

const LEVELS: [label: string, n: number][] = [
  ['Small', 1],
  ['Medium', 2],
  ['Large', 3],
];

// Bucket a stored numeric amount (possibly from the legacy 1..10 scale) to a
// level: null → none, <= 1 → Small (1), === 2 → Medium (2), >= 3 → Large (3).
function bucket(value?: number | null): number | null {
  if (value == null) return null;
  if (value <= 1) return 1;
  if (value === 2) return 2;
  return 3;
}

export function DiaperAmountScale({ value, color, onSelect }: DiaperAmountScaleProps) {
  const t = useTheme();
  const selected = bucket(value);
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {LEVELS.map(([label, n]) => {
        const sel = selected === n;
        return (
          <Pressable
            key={n}
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
