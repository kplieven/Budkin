import { Redirect } from 'expo-router';

import { useAppStore } from '@/store/useAppStore';

export default function Index() {
  const tutorialSeen = useAppStore((s) => s.tutorialSeen);
  const connected = useAppStore((s) => s.connected);
  if (!tutorialSeen) return <Redirect href="/welcome" />;
  return <Redirect href={connected ? '/(tabs)' : '/onboarding'} />;
}
