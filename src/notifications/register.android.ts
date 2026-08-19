import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

import { childToSelectOnOpen } from '@/lib/deepLink';
import { REMINDER_CHANNEL_ID, TIMER_CHANNEL_ID } from '@/notifications/content';
import { useAppStore } from '@/store/useAppStore';

// Without a handler, notifications posted while the app is in the FOREGROUND are
// suppressed. Sound is left to the channel, so shouldPlaySound stays false.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// LOW importance: a running timer is a persistent status, not an alert, so no
// sound, vibration, or heads-up.
void Notifications.setNotificationChannelAsync(TIMER_CHANNEL_ID, {
  name: 'Running timers',
  importance: Notifications.AndroidImportance.LOW,
});

// DEFAULT importance: these are alerts a parent should actually notice.
void Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
  name: 'Reminders',
  importance: Notifications.AndroidImportance.DEFAULT,
});

// Notifications carry an app-generated destination in `data.url`, and most name
// the child they are about (`?child=<localId>`), because an alert sits in the tray
// long enough to outlive a child switch.
//
// NOTE this is the ONLY entry point that acts on `?child=` for a navigation-only
// destination. A second producer (a widget button, a pasted url) would have its
// parameter silently ignored, since the tabs those urls land on read no params of
// their own.
function openFromResponse(response: Notifications.NotificationResponse | null): void {
  const url = response?.notification.request.content.data?.url;
  if (typeof url !== 'string' || !url.startsWith('/')) return;
  // Navigation-only destinations only: '/log/<type>' and '/timer' resolve the
  // parameter themselves, since they open a write surface.
  whenHydrated(() => {
    const state = useAppStore.getState();
    const select = childToSelectOnOpen(url, state.children, state.selectedChildId);
    if (select) state.selectChild(select);
  });
  router.navigate(url as never);
}

/** Runs `apply` once the store holds the persisted roster and selection. A
 *  cold-start tap arrives while `hydrate` is still reading AsyncStorage, and
 *  hydration RESTORES the persisted selection over anything set before it lands.
 *
 *  `unsubscribe` before `apply` is load-bearing: `apply` calls `selectChild`,
 *  which re-enters `set()` synchronously and would re-invoke this listener. */
function whenHydrated(apply: () => void): void {
  if (!useAppStore.getState().hydrating) return apply();
  const unsubscribe = useAppStore.subscribe((state) => {
    if (state.hydrating) return;
    unsubscribe();
    apply();
  });
}

// Warm taps (app running or backgrounded).
Notifications.addNotificationResponseReceivedListener(openFromResponse);

// Cold start: the tap that launched the app. Defer a tick so the router is mounted.
void Notifications.getLastNotificationResponseAsync().then((r) => {
  if (r) setTimeout(() => openFromResponse(r), 0);
});
