import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';

import { Txt } from '@/components/Txt';
import { useTheme } from '@/theme/useTheme';
import { useAppStore } from '@/store/useAppStore';

/** Bottom-center transient toast, driven by the store's `toast` value. */
export function Toast() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useAppStore((s) => s.toast);
  if (!toast) return null;
  return (
    <Animated.View
      pointerEvents="none"
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
        backgroundColor: t.dark ? '#F3EBE1' : '#3A2E24',
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderRadius: 14,
        boxShadow: '0px 8px 30px rgba(0,0,0,0.4)',
      }}
    >
      <Txt weight={700} size={14.5} color={t.dark ? '#3A2E24' : '#ffffff'}>
        {toast}
      </Txt>
    </Animated.View>
  );
}
