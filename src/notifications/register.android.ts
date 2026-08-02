import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

import { childToSelectOnOpen } from '@/lib/deepLink';
import { REMINDER_CHANNEL_ID, TIMER_CHANNEL_ID } from '@/notifications/content';
import { useAppStore } from '@/store/useAppStore';

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
// dates, '/history' for age milestones. Most also name the child they are about
// (`?child=<localId>`), because the screens they land on all read the global
// selection and an alert sits in the tray long enough to outlive a child switch.
//
// NOTE this is the ONLY entry point that acts on `?child=` for a navigation-only
// destination, which is sound today because notifications are the only thing that
// produces one. A second producer (a widget button pointing at '/history', a
// pasted web url) would have its parameter silently ignored, since the tabs those
// urls land on read no params of their own. Give any such url a route that
// resolves the parameter, or lift this into the linking layer.
function openFromResponse(response: Notifications.NotificationResponse | null): void {
  const url = response?.notification.request.content.data?.url;
  if (typeof url !== 'string' || !url.startsWith('/')) return;
  // Only the navigation-only destinations are selected for here: '/log/<type>'
  // and '/timer' have a route of their own that resolves the parameter, since
  // they open a write surface and must refuse a child we no longer have. See
  // `childToSelectOnOpen`.
  whenHydrated(() => {
    const state = useAppStore.getState();
    const select = childToSelectOnOpen(url, state.children, state.selectedChildId);
    if (select) state.selectChild(select);
  });
  router.navigate(url as never);
}

/** Runs `apply` once the store holds the persisted roster and selection.
 *
 *  A cold-start tap arrives while `hydrate` is still reading AsyncStorage, so
 *  the roster is empty and the child the url names would read as one we no
 *  longer have. Hydration also RESTORES the persisted selection, which would
 *  overwrite anything set before it lands, so waiting is the only correct order.
 *  A warm tap runs straight through.
 *
 *  One ordering here is load-bearing: `unsubscribe` before `apply`, because
 *  `apply` calls `selectChild`, which re-enters `set()` synchronously and would
 *  otherwise re-invoke this listener. Today's `apply` recomputes to a no-op on
 *  that second pass, the child it names being the selected one by then, so this
 *  order is what stops a later, less idempotent one from recursing.
 *
 *  There used to be a second one. `selectChild` fired a `refresh()` in server
 *  mode, and because `apply` runs from inside hydrate's own `set()`, that fetch
 *  won the race against hydrate's own `void get().refresh()` and left it to
 *  no-op on `refreshInFlight`. Which of the two won mattered, because a fetch
 *  covered ONE child and the winner decided whether that was the deep-linked
 *  child or the persisted one. Since 0.15.0 `selectChild` fires nothing and a
 *  load covers every child, so hydrate's refresh simply runs and the deep-linked
 *  child's records arrive in it either way. */
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
