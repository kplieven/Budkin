import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { ALL_ACTIVITIES } from '@/lib/activities';
import { useAppStore } from '@/store/useAppStore';
import type { ActivityType } from '@/types/models';

/**
 * Deep-link target: `babybuddy://log/<type>` (e.g. from a home-screen widget).
 * Opens the matching Quick-Log sheet over Home, or routes to onboarding if the
 * app isn't connected yet.
 *
 * The Quick-Log sheet is a root-level overlay driven by global state, so opening
 * it only needs `openSheet`. Navigation back to the tabs uses a declarative
 * <Redirect> (not an imperative router.replace() in the effect) so it survives a
 * cold start where the navigation container ref isn't live yet — see timer.tsx.
 */
export default function LogDeepLink() {
  const { type } = useLocalSearchParams<{ type: string }>();
  const connected = useAppStore((s) => s.connected);
  const openSheet = useAppStore((s) => s.openSheet);

  useEffect(() => {
    if (!connected) return;
    const activity = type as ActivityType;
    if (ALL_ACTIVITIES.includes(activity)) openSheet(activity);
  }, [connected, type, openSheet]);

  if (!connected) return <Redirect href="/onboarding" />;
  return <Redirect href="/(tabs)" />;
}
