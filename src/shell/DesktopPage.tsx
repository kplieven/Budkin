import type { ReactNode } from 'react';
import { ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { useTheme } from '@/theme/useTheme';

/**
 * Centered, max-width scroll container for a screen rendered inside the desktop
 * shell. The sidebar + top bar already supply the chrome, so screens drop their
 * phone header and safe-area padding and render their body through this. Width
 * caps follow the web handoff (Settings 560, History/Timers 760).
 */
export function DesktopPage({ maxWidth = 760, children, onScroll }: { maxWidth?: number; children: ReactNode; onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void }) {
  const t = useTheme();
  return (
    <ScrollView
      onScroll={onScroll}
      scrollEventThrottle={160}
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: 6, paddingHorizontal: 32, paddingBottom: 36, alignItems: 'center' }}
    >
      <View style={{ width: '100%', maxWidth }}>{children}</View>
    </ScrollView>
  );
}
