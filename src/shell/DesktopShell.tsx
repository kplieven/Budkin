import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Sidebar } from '@/shell/Sidebar';
import { TopBar } from '@/shell/TopBar';
import { useTheme } from '@/theme/useTheme';

/**
 * Large-screen frame: a 3-region layout (sidebar | [top bar + routed content]).
 *
 * Mounted once at the root layout (above the navigator) so it persists across
 * every app route — including Settings, which lives outside the (tabs) group.
 * `children` is the navigator (the root <Stack/>) whose active route renders in
 * the main region.
 */
export function DesktopShell({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: t.bg }}>
      <Sidebar />
      <View style={{ flex: 1 }}>
        <TopBar />
        <View style={{ flex: 1 }}>{children}</View>
      </View>
    </View>
  );
}
