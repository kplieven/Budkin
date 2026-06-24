import { Slot } from 'expo-router';
import { View } from 'react-native';

import { Sidebar } from '@/shell/Sidebar';
import { TopBar } from '@/shell/TopBar';
import { useTheme } from '@/theme/useTheme';

/**
 * Large-screen shell: a 3-region frame (sidebar | [top bar + routed content]).
 *
 * Skeleton stage: the main region renders the active (tabs) screen verbatim via
 * <Slot/>. Those screens still carry their own phone chrome (safe-area padding,
 * in-screen child header); extracting chrome-free *Content bodies and adding the
 * dashboard timeline rail are later steps. The point here is the breakpoint flip
 * and the frame, sharing one store with the phone layout.
 */
export function DesktopShell() {
  const t = useTheme();
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: t.bg }}>
      <Sidebar />
      <View style={{ flex: 1 }}>
        <TopBar />
        <View style={{ flex: 1 }}>
          <Slot />
        </View>
      </View>
    </View>
  );
}
