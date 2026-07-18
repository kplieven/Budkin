import { router, useLocalSearchParams } from 'expo-router';

import { Walkthrough } from '@/features/walkthrough/Walkthrough';
import { useAppStore } from '@/store/useAppStore';

/**
 * The first-run walkthrough route. `?replay=1` (set by the Settings row) means
 * this was reopened from inside the app, so dismiss returns via back(); on a
 * genuine first run it advances into the connect flow (or the app if already
 * connected). Marking the tutorial seen happens in both paths.
 */
export default function Welcome() {
  const params = useLocalSearchParams<{ replay?: string }>();
  const replay = params.replay === '1';
  const connected = useAppStore((s) => s.connected);
  const completeTutorial = useAppStore((s) => s.completeTutorial);

  const done = () => {
    completeTutorial();
    if (replay) router.back();
    else router.replace(connected ? '/(tabs)' : '/onboarding');
  };

  return <Walkthrough onDone={done} />;
}
