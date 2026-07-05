# Per-timer ongoing notifications (Android)

**Date:** 2026-07-04
**Status:** Approved, ready for planning

## Problem

A running timer (feeding, sleep, pumping, tummy) is only visible inside the app.
Once the user leaves the app there's no ambient reminder that a timer is running
and no quick way back to it. Android's ongoing/sticky notifications are the
natural surface for "something is running right now."

## Goal

While a timer runs, show **one always-active (sticky) notification per running
timer** in the Android tray:

- Shows which child + activity and when it started (**static** start-time label,
  no live-ticking clock).
- **Tapping the notification opens the app to the timers page**, where the timer
  can be stopped or edited.

The notification's lifecycle tracks the timer's: appears on start, updates on
edit, disappears on stop/discard. It is a **read + shortcut** surface — it holds
no action buttons.

## Non-goals

- **No in-tray action buttons (no Stop button).** Deferred by choice: the button
  is where all the background-execution complexity and the only real reliability
  risk live, and it is a clean *additive* upgrade later (the post/dismiss/tap
  infrastructure below is identical with or without it). Stopping happens in the
  app after tapping.
- **iOS / web:** no-op. iOS has no ongoing-notification concept; its analog is
  Live Activities (ActivityKit / WidgetKit — a native target with no first-party
  Expo support). Deliberately deferred to a separate future project.
- **No live-ticking elapsed clock.** Static "Started 2:45 PM" only.
- **No inline field editing** in the notification.
- **No notification grouping/summary** for many concurrent timers (each timer =
  its own notification, ungrouped).
- **No reboot restoration.** Android clears notifications on reboot; the app
  re-posts for still-running timers on next launch. No foreground service /
  `BOOT_COMPLETED` receiver.

## Decisions (resolved during brainstorming)

- **Android only, now.** Smallest self-contained scope; slots into the app's
  existing headless-Android architecture. iOS Live Activities are out of scope.
- **No buttons — tap-to-open.** The notification is ambient presence + a one-tap
  route back into the app. A Stop button can be bolted on later with no rework.
- **Tap opens the `/timers` route** (a real expo-router route), not the
  store-driven editor sheet — robust for multiple concurrent timers and avoids
  any cold-start sheet-hosting issue.
- **Static start-time label**, not a live-ticking chronometer.
- **Every running timer** gets a notification — feeding, sleep, pumping, tummy
  alike (`diaper` is a point activity, never timed).

## Architecture

The app already runs this exact pattern for its home-screen widget:
`src/widgets/sync.ts` subscribes to the store and, on every change, reconciles an
external surface (the widget snapshot) from `state.timers`, platform-guarded and
debounced by a serialized key. **Notification sync is a second, parallel
subscriber that reconciles the notification tray the same way.**

### File layout (mirrors `src/widgets/`)

```
src/notifications/
  content.ts           # pure: buildTimerNotification(timer, childName) →
                       #   { identifier, title, body, data }
  post.ts              # shared post/dismiss helpers (presentNotification /
                       #   dismissNotification by identifier) — used by sync and
                       #   by napToggle
  sync.ts              # initTimerNotificationSync(): store subscriber that
                       #   reconciles tray ↔ state.timers, AND wires the
                       #   tap → /timers response listener. Android-guarded,
                       #   key-debounced.
  permissions.ts       # ensureNotificationPermission(): request POST_NOTIFICATIONS
  register.ts          # no-op stub (web / iOS)
  register.android.ts  # side-effect import: create the "timers" channel
```

Wiring: call `initTimerNotificationSync()` in `src/app/_layout.tsx` right beside
the existing `initWidgetSync()` (line 49). Import `@/notifications/register` for
its side effect the same way `@/widgets/register` is imported.

No new native code, no background task, no `expo-task-manager`, and no changes to
the store's `stopTimer` / timer→entry logic.

### 1. Notification lifecycle (the store subscriber)

- **Channel** `timers` — label "Running timers", **LOW** importance (it is a
  persistent status, not an alert: no sound, vibration, or heads-up).
- On every store change, build the desired notification set from `state.timers` +
  selected child, serialize to a key, and skip if unchanged (identical to
  `widgets/sync.ts`). Otherwise reconcile:
  - running timer with no notification → **post**
  - running timer whose content changed (edited start/activity) → **re-post**
    (same identifier updates in place)
  - notification whose timer is gone → **dismiss**
- **`identifier = timer.id`** makes post/update/dismiss deterministic and
  idempotent.

### 2. Notification content (`content.ts`, pure)

| field | value |
|-------|-------|
| `identifier` | `timer.id` |
| `title` | `` `${childName} · ${ACTIVITY_LABEL[timer.saveAs]}` `` — e.g. "Ellie · Feeding" |
| `body` | `` `Started ${formatClock(timer.start)}` `` — e.g. "Started 2:45 PM" |
| `sticky` | `true` (ongoing / non-swipeable — best-effort; see edge cases) |
| `data` | `{ url: '/timers', timerId: timer.id }` |

`timerId` is carried for future-proofing (an additive Stop button, or a
tap-to-this-specific-timer variant) but is unused by the v1 tap handler.

### 3. Interaction (tap only)

A root-level `addNotificationResponseReceivedListener` (plus
`getLastNotificationResponseAsync()` for the cold-start case), wired inside
`initTimerNotificationSync`, reads `data.url` and `router.push('/timers')`. Every
timer notification routes to the same timers page, where the user stops/edits.

### 4. Cross-surface consistency

The Nap widget starts/stops naps **headlessly** (`napToggle`), bypassing the
store and therefore the notification subscriber. To keep the tray honest,
`napToggle` uses the shared `post.ts` helpers:

- **stop branch → dismiss** the notification by id. This is the important one: a
  nap stopped from the widget must not leave a ghost "nap running" notification.
- **start branch → post** the notification (best-effort). If posting from the
  widget's headless task context proves unreliable, it is harmless — the store
  subscriber reconciles and posts on next app open.

No entry-building or timer→entry logic is involved here (that all stays in the
store, untouched) — only a post and a dismiss.

### 5. Permissions & build config

- Add `expo-notifications` dependency and its config plugin to `app.json`.
- Rebuild the dev client (`expo run:android`) — new native module + plugin.
- **Android 13+ `POST_NOTIFICATIONS`:** request contextually on the **first timer
  start** via `ensureNotificationPermission()`. If denied, the whole feature
  silently no-ops; timers keep working exactly as today.
- Create the `timers` channel at startup in `register.android.ts`.

## Platform / edge-case behavior

- **web / iOS:** `initTimerNotificationSync` and `register.ts` no-op
  (`Platform.OS !== 'android'`), mirroring the widget register split.
- **Multiple concurrent timers:** one sticky notification each, ungrouped; all
  tap to `/timers`.
- **User swipes a sticky notification away (Android 14+ allows this):** it stays
  gone until the timer set next changes or the app relaunches (the key-diff won't
  re-post on an unchanged set). Acceptable for v1.
- **Reboot:** OS clears notifications; app re-posts on next launch. No restoration
  machinery.
- **Demo / unconfigured connection:** notifications still show (they are local),
  since they carry no server action.
- **Idempotency:** re-posting with the same `identifier` updates in place; the
  key-diff prevents redundant churn.

## Testing

**Unit (vitest, pure / mocked storage — like `napToggle.test`):**

- `buildTimerNotification` — title/body/identifier/data shaping per activity type.
- Reconcile diff in `sync` — given prev vs next `timers` (and child), assert the
  exact set of posts/dismisses (mock `post.ts`).
- `napToggle` — start posts / stop dismisses the notification (extend the existing
  `napToggle.test`, mocking `post.ts`).

**On-device (verify skill):**

- Permission prompt on first timer start; denial → clean no-op.
- Notification is sticky and shows correct child/activity/start time.
- Tap opens the app on the timers page (warm and cold start).
- Multiple timers → multiple notifications, all routing to `/timers`.
- Widget-started nap posts a notification; widget stop dismisses it.
- Reboot clears; reopening re-posts for still-running timers.
