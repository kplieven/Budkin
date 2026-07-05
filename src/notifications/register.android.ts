import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

import { TIMER_CHANNEL_ID } from '@/notifications/content';

// Without a handler, notifications posted while the app is in the FOREGROUND are
// suppressed (not shown in the tray). This makes them appear; sound is left to the
// channel (LOW = silent), so shouldPlaySound stays false.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// A LOW-importance channel: this is a persistent status, not an alert — no sound,
// vibration, or heads-up. Notifications are bound to it by the channel-aware
// trigger in postNotification.android.ts.
void Notifications.setNotificationChannelAsync(TIMER_CHANNEL_ID, {
  name: 'Running timers',
  importance: Notifications.AndroidImportance.LOW,
});

// Tapping a timer notification routes to the timers page (where the user stops /
// edits). All timer notifications carry data.url === '/timers'.
function openFromResponse(response: Notifications.NotificationResponse | null): void {
  const url = response?.notification.request.content.data?.url;
  if (url === '/timers') router.navigate('/timers');
}

// Warm taps (app running or backgrounded).
Notifications.addNotificationResponseReceivedListener(openFromResponse);

// Cold start: the tap that launched the app. Defer a tick so the router is mounted.
void Notifications.getLastNotificationResponseAsync().then((r) => {
  if (r) setTimeout(() => openFromResponse(r), 0);
});
