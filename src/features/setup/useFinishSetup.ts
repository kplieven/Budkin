import { router } from 'expo-router';

import { useAppStore } from '@/store/useAppStore';

/**
 * Ends the first-run setup flow. Marking the tutorial seen has to happen before
 * the navigation: Home redirects back to `/welcome` while `tutorialSeen` is
 * false (see src/app/(tabs)/index.tsx), so replacing first would bounce the
 * user straight back into setup. Every branch of the wizard exits through here.
 */
export function useFinishSetup(): () => void {
  const completeTutorial = useAppStore((s) => s.completeTutorial);
  return () => {
    completeTutorial();
    router.replace('/(tabs)');
  };
}
