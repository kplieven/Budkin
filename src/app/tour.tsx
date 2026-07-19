import { router } from 'expo-router';

import { Walkthrough } from '@/features/walkthrough/Walkthrough';

/**
 * The feature tour, reachable from Settings > Help. First run is a setup wizard
 * now (src/app/welcome.tsx), so this route only ever opens from inside the app
 * and dismissing returns the way the user came. It deliberately does not touch
 * `tutorialSeen`: the setup flow owns that flag.
 */
export default function Tour() {
  return <Walkthrough onDone={() => router.back()} />;
}
