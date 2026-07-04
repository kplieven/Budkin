import { Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';

import { isHovered } from '@/components/hover';
import { Txt } from '@/components/Txt';
import { useTheme } from '@/theme/useTheme';
import { useAppStore } from '@/store/useAppStore';

/** Bottom-center transient toast, driven by the store's `toast` value. May carry
 *  a single tappable action (e.g. "Undo" after a delete). */
export function Toast() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useAppStore((s) => s.toast);
  const action = useAppStore((s) => s.toastAction);
  if (!toast) return null;
  const fg = t.dark ? '#3A2E24' : '#ffffff';
  return (
    <Animated.View
      // Let touches pass through the toast, except the action button below.
      pointerEvents={action ? 'box-none' : 'none'}
      accessibilityLiveRegion="polite"
      role="alert"
      aria-live="polite"
      entering={FadeInDown.duration(200)}
      exiting={FadeOutUp.duration(200)}
      style={{
        position: 'absolute',
        bottom: insets.bottom + 78,
        alignSelf: 'center',
        zIndex: 60,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 18,
        backgroundColor: t.dark ? '#F3EBE1' : '#3A2E24',
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderRadius: 14,
        boxShadow: '0px 8px 30px rgba(0,0,0,0.4)',
      }}
    >
      <Txt weight={700} size={14.5} color={fg}>
        {toast}
      </Txt>
      {action && (
        <Pressable
          onPress={action.run}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          hitSlop={10}
          style={(s) => [{ cursor: 'pointer' }, isHovered(s) && { opacity: 0.7 }, s.pressed && { opacity: 0.6 }]}
        >
          <Txt weight={800} size={14.5} color={fg} style={{ textDecorationLine: 'underline' }}>
            {action.label}
          </Txt>
        </Pressable>
      )}
    </Animated.View>
  );
}
