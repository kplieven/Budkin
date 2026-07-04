import { Pressable, View } from 'react-native';

import { isHovered } from '@/components/hover';
import { Txt } from '@/components/Txt';
import { useTheme } from '@/theme/useTheme';

interface AmountScaleProps {
  value?: number;
  color: string;
  onSelect: (n: number) => void;
}

export function AmountScale({ value, color, onSelect }: AmountScaleProps) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
        const sel = value === n;
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
            <Txt weight={700} size={13.5} color={sel ? t.onActivity : t.text}>
              {n}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
