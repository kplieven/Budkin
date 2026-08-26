// App entry. The three `register`/`backgroundSync` imports are platform-resolved:
// only Android has real ones (the widget's headless task handler, the notification
// channel, the background reminder reconcile).
import 'expo-router/entry';
import './src/widgets/register';
import './src/notifications/register';
import './src/notifications/backgroundSync';
