import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

import { useTheme } from '@/theme/useTheme';

/**
 * Centered, max-width scroll container for a screen inside the desktop shell: the
 * sidebar and top bar already supply the chrome, so screens drop their own phone
 * header and safe-area padding. Widths follow the handoff (Settings 560, rest 760).
 */
export function DesktopPage({ maxWidth = 760, children }: { maxWidth?: number; children: ReactNode }) {
  const t = useTheme();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: 6, paddingHorizontal: 32, paddingBottom: 36, alignItems: 'center' }}
    >
      <View style={{ width: '100%', maxWidth }}>{children}</View>
    </ScrollView>
  );
}
