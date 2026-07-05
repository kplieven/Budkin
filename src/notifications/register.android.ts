import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

// A LOW-importance channel: this is a persistent status, not an alert — no sound,
// vibration, or heads-up. `defaultChannel: "timers"` (config plugin) routes our
// immediate notifications here.
void Notifications.setNotificationChannelAsync('timers', {
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
