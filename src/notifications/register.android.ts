import * as Notifications from 'expo-notifications';

// A LOW-importance channel: this is a persistent status, not an alert — no sound,
// vibration, or heads-up. `defaultChannel: "timers"` (config plugin) routes our
// immediate notifications here.
void Notifications.setNotificationChannelAsync('timers', {
  name: 'Running timers',
  importance: Notifications.AndroidImportance.LOW,
});
