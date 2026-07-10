import { Tabs } from 'expo-router';

import { AppTabBar } from '@/components/TabBar';
import { useDesktopShell } from '@/shell/useDesktopShell';

// Anchor the group's initial route to Home so a deep link that lands directly on
// a non-default tab (e.g. babybuddy://timer -> /timers on a cold start) builds a
// well-formed nested navigation state with a live target tab to jump to.
export const unstable_settings = { initialRouteName: 'index' };

export default function TabsLayout() {
  const desktop = useDesktopShell();

  // Always mount the same TabRouter-backed <Tabs/> navigator, on both desktop
  // and phone. This group used to swap between <Slot/> (a StackRouter) on
  // desktop and <Tabs/> (a TabRouter) on phone, but crossing the breakpoint
  // remounted one router type over the other's leftover navigation state —
  // expo-router's TabRouter.getStateForRouteNamesChange does an unguarded
  // `state.history.filter(...)`, which throws when it inherits a Stack-shaped
  // state with no `history` array. Keeping one router type sidesteps that
  // entirely. Desktop just hides the bottom bar — the root layout's sidebar
  // and top bar are the desktop nav drivers — while each tab still renders
  // only its own screen content.
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: 'transparent' } }}
      tabBar={desktop ? () => null : (props) => <AppTabBar state={props.state} navigation={props.navigation} />}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="history" options={{ title: 'History' }} />
      <Tabs.Screen name="insights" options={{ title: 'Insights' }} />
      <Tabs.Screen name="growth" options={{ title: 'Growth' }} />
      <Tabs.Screen name="milestones" options={{ title: 'Milestones' }} />
      <Tabs.Screen name="notes" options={{ title: 'Notes' }} />
      {/* Timers is no longer a bottom tab: it is reached from Home (the live-timer
          card + the "Timers" link) and the widget deep link. Kept as a route here
          (AppTabBar omits it) so /timers still resolves. */}
      <Tabs.Screen name="timers" options={{ title: 'Timers' }} />
    </Tabs>
  );
}
