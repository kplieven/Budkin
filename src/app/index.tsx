import { Redirect } from 'expo-router';

import { useAppStore } from '@/store/useAppStore';

/**
 * Entry route: show the first-run setup wizard until it has been seen, then send
 * to the app if connected, otherwise to onboarding.
 */
export default function Index() {
  const tutorialSeen = useAppStore((s) => s.tutorialSeen);
  const connected = useAppStore((s) => s.connected);
  if (!tutorialSeen) return <Redirect href="/welcome" />;
  return <Redirect href={connected ? '/(tabs)' : '/onboarding'} />;
}
