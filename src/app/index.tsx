import { Redirect } from 'expo-router';

import { useAppStore } from '@/store/useAppStore';

/** Entry route: send to the app if connected, otherwise to onboarding. */
export default function Index() {
  const connected = useAppStore((s) => s.connected);
  return <Redirect href={connected ? '/(tabs)' : '/onboarding'} />;
}
