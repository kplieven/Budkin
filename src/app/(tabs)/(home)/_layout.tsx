import { Stack } from 'expo-router';

import { useTheme } from '@/theme/useTheme';

// Home is this stack's root, so a deep link that lands straight on /timers (the
// running-timer notification, the widget shim, the scheduled reminders) builds a
// stack with Home underneath it and the back chevron has somewhere real to go.
export const unstable_settings = { initialRouteName: 'index' };

/**
 * A Stack inside the Home tab, holding Home and Timers.
 *
 * Timers wants a push transition and a back entry, which a tab jump cannot give
 * it, and it wants the bottom bar, which a root-Stack route cannot have. Nesting
 * the Stack inside the tab satisfies both: the bar belongs to the TAB layout one
 * level above this navigator, so it sits outside the animation entirely and stays
 * put while only the screen area slides. Neither URL moves, since route groups
 * never appear in the path: Home is still "/" and Timers still "/timers".
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
