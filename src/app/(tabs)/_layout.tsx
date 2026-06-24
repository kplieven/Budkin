import { Slot, Tabs } from 'expo-router';

import { AppTabBar } from '@/components/TabBar';
import { useDesktopShell } from '@/shell/useDesktopShell';

// Anchor the group's initial route to Home so a deep link that lands directly on
// a non-default tab (e.g. babybuddy://timer -> /timers on a cold start) builds a
// well-formed nested navigation state with a live target tab to jump to.
export const unstable_settings = { initialRouteName: 'index' };

export default function TabsLayout() {
  const desktop = useDesktopShell();

  // Desktop: the root layout already supplies the sidebar shell, so this group
  // renders just the active tab screen (sidebar nav drives routing). Phone: the
  // bottom tab navigator.
  if (desktop) return <Slot />;

  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: 'transparent' } }}
      tabBar={(props) => <AppTabBar state={props.state} navigation={props.navigation} />}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="timers" options={{ title: 'Timers' }} />
      <Tabs.Screen name="history" options={{ title: 'History' }} />
      <Tabs.Screen name="growth" options={{ title: 'Growth' }} />
    </Tabs>
  );
}
