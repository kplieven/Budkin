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
import { useKeyboardHeight } from '@/components/useKeyboardHeight';
import { ChildSheet } from '@/features/childSwitcher/ChildSheet';
import { ChildSwitcher } from '@/features/childSwitcher/ChildSwitcher';
import { AdoptSheet } from '@/features/connect/AdoptSheet';
import { TreatmentEditor } from '@/features/treatments/TreatmentEditor';
import { TreatmentPickerSheet } from '@/features/treatments/TreatmentPickerSheet';
import { ConfirmBirthSheet } from '@/features/dashboard/ConfirmBirthSheet';
import { LogSheet } from '@/features/log/LogSheet';
import { MeasurementSheet } from '@/features/measurements/MeasurementSheet';
import { MilestoneSheet } from '@/features/milestones/MilestoneSheet';
import { DesktopShell } from '@/shell/DesktopShell';
import { useDesktopShell } from '@/shell/useDesktopShell';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';
import { FONTS_TO_LOAD } from '@/theme/fonts';
import { requestPersistentStorage } from '@/lib/persistentStorage';
import { initTimerNotificationSync } from '@/notifications/sync';
import { initScheduledReminderSync, reconcileNow } from '@/notifications/scheduleSync';
import { initBackgroundSync } from '@/notifications/backgroundSync';
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
  // backgrounded would stick until a full restart. `reconcileNow()` rides along
  // because `refresh()` only does anything for a live server connection: the
  // scheduled reminders are one-shot triggers needing a reschedule after each fire
  // (see PUMP_AHEAD in scheduled.ts), so local mode would let the chain run out.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refresh();
        reconcileNow();
      }
    });
    return () => sub.remove();
  }, [refresh]);

  useEffect(() => {
    initWidgetSync();
    initTimerNotificationSync();
    initScheduledReminderSync();
    // Registers the periodic WorkManager job. No-ops off Android. `void`: the
    // registration is fire-and-forget, and it already swallows its own failures.
    void initBackgroundSync();
    // Web only (no-ops on native): keep the browser from evicting localStorage,
    // which is where the entity store, the offline queue and the op-log all live.
    void requestPersistentStorage();
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
  // Android draws edge-to-edge, so the IME covers the window instead of resizing it and
  // `adjustResize` does nothing. Shrinking the root here is that resize, done in JS: every
  // screen, sheet and overlay below is laid out into the space the keyboard leaves, and
  // ScrollView's own onSizeChanged brings the focused field back into view. 0 elsewhere.
  const keyboardHeight = useKeyboardHeight();
  const base = t.dark ? DarkTheme : DefaultTheme;
  const navTheme = { ...base, colors: { ...base.colors, background: t.bg } };

  // On large screens, wrap the whole navigator in the sidebar shell so it persists
  // across every route, including Settings, which lives outside the (tabs) group.
  // Hidden on the full-screen pre-app routes. The Stack itself is untouched, so the
  // cold-start deep-link nav structure is unchanged.
  const showShell =
    desktop && segments[0] !== 'onboarding' && segments[0] !== 'welcome' && segments[0] !== 'setup';
  const stack = (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="welcome" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="settings" />
      {/* Timers is NOT here. It lives on a Stack inside the Home tab
          (src/app/(tabs)/(home)/), which is what lets it be pushed, transition and
          back entry, while the bottom bar owned by the tab layout above that Stack
          stays put instead of sliding in with it. On the root Stack it could have
          one or the other, never both. The URL is /timers either way: group
          segments never appear in the path. */}
      <Stack.Screen name="metric/[kind]" />
    </Stack>
  );

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: t.bg }}>
      <SafeAreaProvider>
        <ThemeProvider value={navTheme}>
          {/* MARGIN, not padding. Padding would shrink the content box and move the flow
              children (the navigator, the tab bar) while leaving every absolutely
              positioned one where it was: an abspos child is laid out against its
              container's PADDING box, whose bottom edge sits below the padding. That is
              exactly the bug it produced — the tab bar rose above the keyboard and the
              bottom sheets, which are abspos, stayed pinned behind it. A margin shrinks
              the root's own box instead, so both kinds of child follow. */}
          <View style={{ flex: 1, backgroundColor: t.bg, marginBottom: keyboardHeight }}>
            {showShell ? <DesktopShell>{stack}</DesktopShell> : stack}

            {/* overlays rendered above the navigator and tab bar */}
            <ChildSwitcher />
            <ChildSheet />
            <ConfirmBirthSheet />
            <AdoptSheet />
            <LogSheet />
            <MeasurementSheet />
            <MilestoneSheet />
            <TreatmentPickerSheet />
            <TreatmentEditor />
            <Toast />
          </View>
          <StatusBar style={t.dark ? 'light' : 'dark'} />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
