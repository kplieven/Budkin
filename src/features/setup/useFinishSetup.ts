import { router } from 'expo-router';
import { useCallback } from 'react';

import { useAppStore } from '@/store/useAppStore';

/**
 * Ends the first-run setup flow. Marking the tutorial seen has to happen before
 * the navigation: Home redirects back to `/welcome` while `tutorialSeen` is
 * false (see src/app/(tabs)/index.tsx), so replacing first would bounce the
 * user straight back into setup. Every branch of the wizard exits through here.
 *
 * The setup steps are reached with push, so they are dismissed before entering
 * the app. A bare replace only swaps the top entry, which would leave /welcome
 * (and on the empty-server path /onboarding) sitting underneath Home, where a
 * Back gesture would drop the user back into the wizard.
 *
 * Memoized because callers put it in effect dependency arrays: an unmemoized
 * closure would re-fire those effects on every render of the calling screen.
 */
export function useFinishSetup(): () => void {
  const completeTutorial = useAppStore((s) => s.completeTutorial);
  return useCallback(() => {
    completeTutorial();
    if (router.canDismiss()) router.dismissAll();
    router.replace('/(tabs)');
  }, [completeTutorial]);
}
