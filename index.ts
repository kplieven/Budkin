// App entry. The two `register` imports are platform-resolved: only Android has
// real ones (the widget's headless task handler, the notification channel).
import 'expo-router/entry';
import './src/widgets/register';
import './src/notifications/register';
