import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { resolveTimerDeepLink } from '@/lib/deepLink';
import { useAppStore } from '@/store/useAppStore';

/** Deep-link target for the widget's Timer button: start a timer and open Timers.
 *
 *  Navigation uses a declarative <Redirect> rather than an imperative router.replace() in
 *  the effect. On a cold start this route can mount before expo-router's navigation
 *  container ref is live, and a one-shot replace() is then enqueued and silently dropped,
 *  stranding the user on a blank route. <Redirect> re-emits until the route changes.
 *
 *  `?child=<localId>` names who the button was rendered for, since the widget's bitmap
 *  outlives the selection it was built from. `resolveTimerDeepLink` refuses an unknown or
 *  still-expected child, and both refusals redirect to Home instead of Timers. */
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
    // Resolved again HERE, off `getState()`, rather than reusing what the render
    // computed: selecting the child moves `selectedChildId`, so a subscribed value
    // in the dep list would re-run this effect on its own write and start a second
    // timer.
    const s = useAppStore.getState();
    const action = resolveTimerDeepLink({ child, connected, children: s.children, selectedChildId: s.selectedChildId });
    if (action.kind !== 'start') return;
    // Before starting: `startQuickTimer` stamps the timer with whoever is selected,
    // which is the whole reason the link carries a child at all.
    if (action.selectChildId) selectChild(action.selectChildId);
    startQuickTimer();
  }, [child, connected, selectChild, startQuickTimer]);

  if (!connected) return <Redirect href="/onboarding" />;
  if (refused) return <Redirect href="/(tabs)" />;
  return <Redirect href="/timers" />;
}
