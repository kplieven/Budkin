import { View } from 'react-native';

import { useTheme } from '@/theme/useTheme';

/** Pill-shaped on/off switch face used inside a `Pressable` row that carries
 *  `accessibilityRole="switch"`. Purely visual: it renders `on`, it does not
 *  handle the press itself. */
export function Toggle({ on }: { on: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        width: 50,
        height: 30,
        borderRadius: 99,
        backgroundColor: on ? t.primary : t.elevated,
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          position: 'absolute',
          top: 3,
          left: on ? 23 : 3,
          width: 24,
          height: 24,
          borderRadius: 99,
          backgroundColor: '#fff',
          boxShadow: '0px 1px 3px rgba(0,0,0,0.3)',
        }}
      />
    </View>
  );
}
