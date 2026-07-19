import { router } from 'expo-router';
import { useCallback } from 'react';

import { useAppStore } from '@/store/useAppStore';

/**
 * Ends the first-run setup flow. Marking the tutorial seen has to happen before
 * the navigation: Home redirects back to `/welcome` while `tutorialSeen` is
 * false (see src/app/(tabs)/index.tsx), so replacing first would bounce the
 * user straight back into setup. Every branch of the wizard exits through here.
 *
 * Memoized because callers put it in effect dependency arrays: an unmemoized
 * closure would re-fire those effects on every render of the calling screen.
 */
export function useFinishSetup(): () => void {
  const completeTutorial = useAppStore((s) => s.completeTutorial);
  return useCallback(() => {
    completeTutorial();
    router.replace('/(tabs)');
  }, [completeTutorial]);
}
