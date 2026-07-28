import { Redirect } from 'expo-router';
import { useEffect } from 'react';

import { useAppStore } from '@/store/useAppStore';

/** Deep-link target `budkin://timer` (widget "Timer" button): start a timer
 *  and open the Timers screen.
 *
 *  Navigation uses a declarative <Redirect> rather than an imperative
 *  router.replace() in the effect. On a cold start (app opened from the widget
 *  while closed) the deep-link route can mount before expo-router's navigation
 *  container ref is live; a one-shot router.replace() is enqueued and then
 *  silently dropped, stranding the user on a blank route (the app "just opens").
 *  <Redirect> navigates via useFocusEffect and re-emits until the route actually
 *  changes, so it survives that window.
 *
 *  When the selected child is expected (not yet born), starting a timer would
 *  log an activity against a due date rather than a birth date, so the effect
 *  below refuses and this redirects to Home instead of Timers, matching the
 *  guard in log/[type].tsx. */
export default function TimerDeepLink() {
  const connected = useAppStore((s) => s.connected);
  const startQuickTimer = useAppStore((s) => s.startQuickTimer);
  const expected = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId)?.expected ?? false);

  useEffect(() => {
    if (!connected || expected) return;
    startQuickTimer();
  }, [connected, expected, startQuickTimer]);

  if (!connected) return <Redirect href="/onboarding" />;
  if (expected) return <Redirect href="/(tabs)" />;
  return <Redirect href="/timers" />;
}
