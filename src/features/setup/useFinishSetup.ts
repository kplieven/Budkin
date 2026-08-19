import { router } from 'expo-router';
import { useCallback } from 'react';

import { useAppStore } from '@/store/useAppStore';

/**
 * Ends the first-run setup flow. Marking the tutorial seen has to happen before the
 * navigation: Home redirects back to `/welcome` while `tutorialSeen` is false, so
 * replacing first would bounce the user straight back into setup. The setup steps are
 * reached with push, so they need dismissing too: a bare replace only swaps the top
 * entry, leaving /welcome (and on the empty-server path /onboarding) under Home where
 * a Back gesture drops the user back into the wizard. Memoized because callers put it
 * in effect dependency arrays.
 */
export function useFinishSetup(): () => void {
  const completeTutorial = useAppStore((s) => s.completeTutorial);
  return useCallback(() => {
    completeTutorial();
    if (router.canDismiss()) router.dismissAll();
    router.replace('/(tabs)');
  }, [completeTutorial]);
}
