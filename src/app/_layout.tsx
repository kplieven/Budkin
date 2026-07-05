import { useFonts } from '@expo-google-fonts/figtree/useFonts';
import { useNetworkState } from 'expo-network';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { AppState, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Toast } from '@/components/Toast';
import { ChildSwitcher } from '@/features/childSwitcher/ChildSwitcher';
import { LogSheet } from '@/features/log/LogSheet';
import { MeasurementSheet } from '@/features/measurements/MeasurementSheet';
import { DesktopShell } from '@/shell/DesktopShell';
import { useDesktopShell } from '@/shell/useDesktopShell';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';
import { FONTS_TO_LOAD } from '@/theme/fonts';
import { initTimerNotificationSync } from '@/notifications/sync';
import { initWidgetSync } from '@/widgets/sync';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts(FONTS_TO_LOAD);
  const tick = useAppStore((s) => s.tick);
  const hydrate = useAppStore((s) => s.hydrate);
  const hydrating = useAppStore((s) => s.hydrating);
  const refresh = useAppStore((s) => s.refresh);
  const setNetworkOnline = useAppStore((s) => s.setNetworkOnline);
  const net = useNetworkState();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Re-check the server whenever the app comes back to the foreground (or the web
  // tab regains focus). `expo-network` only reports *device* connectivity and its
  // effect fires only on a change, so without this a stale `offline` set while
  // backgrounded would stick until a full restart.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  useEffect(() => {
    initWidgetSync();
    initTimerNotificationSync();
  }, []);

  useEffect(() => {
    if (net.isConnected !== undefined) setNetworkOnline(net.isConnected);
  }, [net.isConnected, setNetworkOnline]);

  useEffect(() => {
    if ((loaded || error) && !hydrating) SplashScreen.hideAsync();
  }, [loaded, error, hydrating]);

  useEffect(() => {
    const id = setInterval(() => tick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [tick]);

  if ((!loaded && !error) || hydrating) return null;
  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const t = useTheme();
  const desktop = useDesktopShell();
  const segments = useSegments();
  const base = t.dark ? DarkTheme : DefaultTheme;
  const navTheme = { ...base, colors: { ...base.colors, background: t.bg } };

  // On large screens, wrap the whole navigator in the sidebar shell so it
  // persists across every route — including Settings, which lives outside the
  // (tabs) group. Hidden on onboarding (a full-screen, pre-app route). Phone is
  // untouched (useDesktopShell is false at phone widths), as is the Stack itself,
  // so the cold-start deep-link nav structure is unchanged.
  const showShell = desktop && segments[0] !== 'onboarding';
  const stack = (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="settings" />
    </Stack>
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider value={navTheme}>
          <View style={{ flex: 1, backgroundColor: t.bg }}>
            {showShell ? <DesktopShell>{stack}</DesktopShell> : stack}

            {/* overlays rendered above the navigator and tab bar */}
            <ChildSwitcher />
            <LogSheet />
            <MeasurementSheet />
            <Toast />
          </View>
          <StatusBar style={t.dark ? 'light' : 'dark'} />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
