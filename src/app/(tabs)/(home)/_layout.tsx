import { Stack } from 'expo-router';

import { useTheme } from '@/theme/useTheme';

// Home is this stack's root, so a deep link that lands straight on /timers
// (the running-timer notification, the widget shim, the stale-timer, pump-ahead
// and nap-ready reminders) builds a stack with Home underneath it and the back
// chevron has somewhere real to go.
export const unstable_settings = { initialRouteName: 'index' };

/**
 * A Stack inside the Home tab, holding Home and Timers.
 *
 * Timers wants a push transition and a back entry, which a tab jump cannot
 * give it, and it wants the bottom bar, which a root-Stack route cannot have.
 * Nesting a Stack inside the tab is what satisfies both: the bar belongs to the
 * TAB layout, one level above this navigator, so it sits outside the animation
 * entirely and stays put while only the screen area slides. Rendering the bar
 * on the Timers screen itself (the previous approach) made it part of the
 * pushed screen, so it travelled in with the transition.
 *
 * Neither URL moves: route groups never appear in the path, so Home is still
 * "/" and Timers is still "/timers", and every existing entry point keeps
 * working untouched.
 */
export default function HomeStackLayout() {
  const t = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="timers" />
    </Stack>
  );
}
