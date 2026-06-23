import { useFonts } from '@expo-google-fonts/figtree/useFonts';
import { useNetworkState } from 'expo-network';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Toast } from '@/components/Toast';
import { ChildSwitcher } from '@/features/childSwitcher/ChildSwitcher';
import { LogSheet } from '@/features/log/LogSheet';
import { MeasurementSheet } from '@/features/measurements/MeasurementSheet';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';
import { FONTS_TO_LOAD } from '@/theme/fonts';
import { initWidgetSync } from '@/widgets/sync';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts(FONTS_TO_LOAD);
  const tick = useAppStore((s) => s.tick);
  const hydrate = useAppStore((s) => s.hydrate);
  const hydrating = useAppStore((s) => s.hydrating);
  const setNetworkOnline = useAppStore((s) => s.setNetworkOnline);
  const net = useNetworkState();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    initWidgetSync();
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
  const base = t.dark ? DarkTheme : DefaultTheme;
  const navTheme = { ...base, colors: { ...base.colors, background: t.bg } };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider value={navTheme}>
          <View style={{ flex: 1, backgroundColor: t.bg }}>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="onboarding" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="settings" />
            </Stack>

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
