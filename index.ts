// App entry. Boots expo-router, then (Android only, via the platform-resolved
// module) registers the home-screen widget's headless task handler.
import 'expo-router/entry';
import './src/widgets/register';
import './src/notifications/register';
