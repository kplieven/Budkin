import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { resolveTimerDeepLink } from '@/lib/deepLink';
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
 *  `?child=<localId>` names who the button was rendered for, since the widget's
 *  bitmap outlives the selection it was built from. The decision itself lives in
 *  `resolveTimerDeepLink`, where a test can reach it: it refuses for a child the
 *  roster no longer holds, and for one still expected (not yet born), because
 *  starting a timer for them would log an activity against a due date rather
 *  than a birth date. Both refusals redirect to Home instead of Timers, matching
 *  the guard in log/[type].tsx. */
export default function TimerDeepLink() {
  const { child } = useLocalSearchParams<{ child?: string }>();
  const connected = useAppStore((s) => s.connected);
  const startQuickTimer = useAppStore((s) => s.startQuickTimer);
  const selectChild = useAppStore((s) => s.selectChild);
  // Raw slices, never a derived object or array: returning a fresh reference
  // from a useAppStore selector loops zustand v5 forever.
  const children = useAppStore((s) => s.children);
  const selectedChildId = useAppStore((s) => s.selectedChildId);
  const refused = resolveTimerDeepLink({ child, connected, children, selectedChildId }).kind === 'none';

  useEffect(() => {
    // Resolved again HERE, off `getState()`, rather than reusing the value the
    // render computed: selecting the child moves `selectedChildId`, so a
    // subscribed value in the dep list would re-run this effect on its own write
    // and start a second timer. `child` and `connected` do not move underneath
    // it that way.
    const s = useAppStore.getState();
    const action = resolveTimerDeepLink({ child, connected, children: s.children, selectedChildId: s.selectedChildId });
    if (action.kind !== 'start') return;
    // Before starting: `startQuickTimer` stamps the timer with whoever is
    // selected, which is the whole reason the link carries a child at all.
    if (action.selectChildId) selectChild(action.selectChildId);
    startQuickTimer();
  }, [child, connected, selectChild, startQuickTimer]);

  if (!connected) return <Redirect href="/onboarding" />;
  if (refused) return <Redirect href="/(tabs)" />;
  return <Redirect href="/timers" />;
}
