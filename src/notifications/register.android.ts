import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

import { REMINDER_CHANNEL_ID, TIMER_CHANNEL_ID } from '@/notifications/content';

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

// DEFAULT importance, unlike the LOW timers channel: these are alerts a parent
// should actually notice, not a persistent status.
void Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
  name: 'Reminders',
  importance: Notifications.AndroidImportance.DEFAULT,
});

// Every notification we post carries its own destination in `data.url`, always
// app-generated: '/timers' for timers and stale-timer alerts, '/' for due
// dates, '/history' for age milestones.
function openFromResponse(response: Notifications.NotificationResponse | null): void {
  const url = response?.notification.request.content.data?.url;
  if (typeof url === 'string' && url.startsWith('/')) router.navigate(url as never);
}

// Warm taps (app running or backgrounded).
Notifications.addNotificationResponseReceivedListener(openFromResponse);

// Cold start: the tap that launched the app. Defer a tick so the router is mounted.
void Notifications.getLastNotificationResponseAsync().then((r) => {
  if (r) setTimeout(() => openFromResponse(r), 0);
});
