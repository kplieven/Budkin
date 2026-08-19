import { Tabs } from 'expo-router';

import { AppTabBar } from '@/components/TabBar';
import { isTabName } from '@/components/tabs';
import { useDesktopShell } from '@/shell/useDesktopShell';

// Anchor the group's initial route to Home so a deep link that lands directly on
// a non-default tab builds a well-formed nested navigation state with a live
// target tab to jump to, rather than a group with no active screen under it.
// Home is the (home) GROUP: it holds a Stack with Home and Timers, so Timers can
// be pushed (transition + back entry) while the bar below stays put.
export const unstable_settings = { initialRouteName: '(home)' };

export default function TabsLayout() {
  const desktop = useDesktopShell();

  // One TabRouter-backed <Tabs/> navigator on both desktop and phone. Swapping to
  // <Slot/> (a StackRouter) at the desktop breakpoint remounts one router type
  // over the other's leftover navigation state, and expo-router's
  // TabRouter.getStateForRouteNamesChange does an unguarded
  // `state.history.filter(...)` that throws on a Stack-shaped state with no
  // `history` array. Desktop just hides the bottom bar; the root layout's sidebar
  // and top bar are its nav drivers.
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: 'transparent' } }}
      tabBar={
        desktop
          ? () => null
          : (props) => {
              const active = props.state.routes[props.state.index]?.name;
              return (
                <AppTabBar
                  activeName={isTabName(active) ? active : null}
                  onSelect={(name) => {
                    // Send a tab that holds a stack back to its root first. Only
                    // (home) has one (Home -> Timers), and TabRouter's NAVIGATE
                    // only moves the tab index, never the nested state, so from
                    // Timers the bar's Home button would do nothing. POP_TO_TOP
                    // is dispatched at the nested navigator by key, as a plain
                    // action object so no react-navigation import is needed.
                    const route = props.state.routes.find((r) => r.name === name);
                    const nested = route?.state;
                    if (nested?.key && (nested.index ?? 0) > 0) {
                      props.navigation.dispatch({ type: 'POP_TO_TOP', target: nested.key });
                    }
                    props.navigation.navigate(name);
                  }}
                />
              );
            }
      }
    >
      <Tabs.Screen name="(home)" options={{ title: 'Home' }} />
      <Tabs.Screen name="history" options={{ title: 'History' }} />
      <Tabs.Screen name="insights" options={{ title: 'Insights' }} />
      <Tabs.Screen name="growth" options={{ title: 'Growth' }} />
      <Tabs.Screen name="milestones" options={{ title: 'Milestones' }} />
      <Tabs.Screen name="notes" options={{ title: 'Notes' }} />
    </Tabs>
  );
}
