# Dedicated nap start/stop widget

**Date:** 2026-07-04
**Status:** Approved, ready for planning

## Problem

The Status home-screen widget's four bottom buttons all **open the app** to log
an event (`babybuddy://log/...`, `babybuddy://timer`). There's no way to start
or stop a nap without launching the app. Adding a quick nap toggle to that same
grid would be confusing: some buttons would open the app while one silently
toggles a timer in place — the same control surface doing two contradictory
things.

## Goal

A **second, single-purpose** Android home-screen widget whose entire surface is
one nap start/stop toggle:

- **Tap while idle** → start a nap timer, in place, no app open.
- **Tap while napping** → stop the timer, save the finished nap, reset to idle —
  in place, no app open.

Because the widget does exactly one thing, the "does this open the app or not?"
ambiguity never arises. The existing Status widget is untouched.

## Non-goals

- No changes to the Status widget's buttons or behavior.
- Not a general-purpose timer — sleep/nap only. (Feeding/pumping/tummy timers
  stay in the app.)
- No editing the nap from the widget (start time, notes, nap-vs-sleep flag). The
  entry is editable in the app afterward like any other.
- No second-by-second live ticking (see Constraints).
- iOS/web: no-op, consistent with the existing Android-only widget.

## Decisions (resolved during brainstorming)

- **Separate widget, not a repurposed Status button.** One widget = one job
  removes the mixed-metaphor confusion.
- **Silent save via the offline queue.** Stop builds the `sleep` entry and
  appends it to the existing offline write queue (`babybuddy.queue.v1`). The app
  drains and syncs it to Baby Buddy on next open, exactly like any offline write.
  No network/auth in the headless task. The user can edit the entry in the app
  later if a time was off.
- **Source of truth on tap is `loadTimers()`**, not the possibly-stale snapshot,
  so the start-vs-stop decision can't act on old data.
- **Labels:** "Start nap" (idle) / "Napping · <elapsed> · tap to stop" (running).
- **Size:** compact (~2×1), resizable.
- **Demo mode / no configured connection:** degrade gracefully — start/stop the
  local timer but skip the queue write (demo entries are local-only and a
  headless tap can't reach the running store).

## Architecture

The toggle logic is pure and shared between the store and the widget so the two
build identical timers/entries. The headless widget task performs the same
AsyncStorage mutations the store would, then re-renders.

### 1. `src/data/sleepTimer.ts` (new) — pure, shared helpers

Extracted so the store and the headless widget agree byte-for-byte.

```ts
export function startSleepTimer(now: number): Timer;
// Factored out of stopTimer()'s sleep branch (useAppStore.ts:914):
export function buildSleepEntry(timer: Timer, now: number, childId: string): Entry;
```

- `startSleepTimer(now)` returns a `Timer` with `activity: 'sleep'`,
  `saveAs: 'sleep'`, `name: ACTIVITY_LABEL.sleep`, `start: now`, and a unique id.
- `buildSleepEntry` mirrors the current sleep branch: `type: 'sleep'`,
  `start: timer.start`, `end: now`, `nap` derived from `now`'s hour
  (`hr >= 7 && hr < 19`), carrying `tags` and `childId`.
- Pure and independently testable; no I/O.

### 2. `src/store/useAppStore.ts` — reuse the helpers

- `stopTimer` (line 914) calls `buildSleepEntry(...)` for its sleep branch
  instead of building the entry inline — one source of truth, no behavior change.
- No new store actions are needed; the widget path is headless.

### 3. `src/widgets/snapshot.ts` — two new fields

- Add `selectedChildId: string` — the headless stop stamps the entry's `childId`
  without a running store.
- Add `canQueueNap: boolean` — true when a real (non-demo) connection exists
  (`!!connection && !connection.demo`). `buildWidgetSnapshot` already receives the
  full store state via `buildWidgetSnapshot(useAppStore.getState())` (see
  `widgets/sync.ts`), so it can read `connection` directly; add it to the
  destructured params. This is how the headless task knows whether to enqueue —
  it doesn't have to infer demo from `selectedChildId` (demo has a child id too).

### 4. `src/widgets/napToggle.ts` (new) — headless toggle action

The behavior invoked when the widget is tapped. Pure-ish orchestration over
existing AsyncStorage modules (`loadTimers`/`saveTimers`, `enqueueEntry`,
`readWidgetSnapshot`/`writeWidgetSnapshot`).

```ts
export async function toggleNapFromWidget(now: number): Promise<WidgetSnapshot | null>;
```

Steps:
1. `const timers = await loadTimers()`; `const running = timers.find(t => t.activity === 'sleep')`.
2. **If running (stop):**
   - `const snap = await readWidgetSnapshot()`.
   - If `snap?.canQueueNap` and `snap.selectedChildId`, build
     `buildSleepEntry(running, now, snap.selectedChildId)` and
     `await enqueueEntry(entry)`. (Demo/unconfigured → skip the queue write.)
   - `await saveTimers(timers.filter(t => t !== running))`.
   - Persist the snapshot with `sleepStart = null`.
3. **If not running (start):**
   - `await saveTimers([...timers, startSleepTimer(now)])`.
   - Persist the snapshot with `sleepStart = now`.
4. Return the updated snapshot for the caller to render.

Snapshot updates here only touch `sleepStart` (and leave the rest as read); the
app's next `buildWidgetSnapshot`/`pushWidgetUpdate` fully reconciles derived
fields like `sleepTodayMin`.

### 5. `src/widgets/NapWidget.tsx` (new) — the widget UI

A `react-native-android-widget` component, `'use no memo'`, `now` passed in
(same purity discipline as `StatusWidget`). Whole surface is one tap target:
`clickAction="NAP_TOGGLE"`.

- **Idle:** sleep glyph (reuse `activitySvg('sleep', SLEEP)`) + "Start nap" on the
  app's dark surface.
- **Napping:** filled `SLEEP`-tinted background, `● Napping`, large elapsed
  `fmtDur((now - sleepStart)/60000)`, and "tap to stop". Reuses the palette
  constants already in `StatusWidget.tsx` (extract the shared `Hex` colors to a
  small `widgets/theme.ts` if convenient; otherwise duplicate the few needed).

### 6. `src/widgets/widgetTaskHandler.tsx` — handle the tap + new widget

- Switch on `props.widgetInfo.widgetName` to render either `StatusWidget` (name
  `"Status"`) or `NapWidget` (name `"Nap"`) for `WIDGET_ADDED/UPDATE/RESIZED`.
- Add a `WIDGET_CLICK` case: when `props.clickAction === 'NAP_TOGGLE'`, call
  `toggleNapFromWidget(Date.now())`, then `props.renderWidget(<NapWidget ... />)`
  with the returned snapshot. This is what makes start/stop happen without
  opening the app.

### 7. `app.json` — register the widget

- Add a second widget to the `react-native-android-widget` config plugin
  (`name: "Nap"`, its own `minWidth`/`minHeight`, `resizeMode`, `previewImage`,
  and `updatePeriodMillis`). The existing `"Status"` widget entry is unchanged.
- Add a preview asset for the widget picker.

### 8. Tests

- `src/data/sleepTimer.test.ts` (new, vitest): `startSleepTimer` shape;
  `buildSleepEntry` mirrors the old inline logic (start/end/nap/tags/childId),
  including the nap-hour boundary.
- Extend `src/data/timers.test.ts` / store tests as needed to confirm `stopTimer`
  still produces the same sleep entry after the refactor.
- `toggleNapFromWidget` behavior (start creates a timer; stop enqueues an entry
  and clears the timer; demo/unknown-child skips the queue write) with the
  AsyncStorage modules mocked, matching `useAppStore.test.ts`'s `@/data/queue` mock.

## Data flow

```
tap widget (idle)
  -> widgetTaskHandler WIDGET_CLICK / NAP_TOGGLE
     -> toggleNapFromWidget(now)
        loadTimers() -> no sleep timer
        saveTimers([...timers, startSleepTimer(now)])
        writeWidgetSnapshot({ ...snap, sleepStart: now })
     -> renderWidget(<NapWidget sleepStart=now />)   // flips to Napping

tap widget (napping)
  -> widgetTaskHandler WIDGET_CLICK / NAP_TOGGLE
     -> toggleNapFromWidget(now)
        loadTimers() -> running sleep timer
        if snap.canQueueNap && snap.selectedChildId:
          buildSleepEntry(running, now, snap.selectedChildId)
          enqueueEntry(entry)                        // offline queue
        saveTimers(without running)
        writeWidgetSnapshot({ ...snap, sleepStart: null })
     -> renderWidget(<NapWidget sleepStart=null />)  // resets to Idle

app next open
  -> hydrate(): loadTimers() shows a widget-started timer on Timers screen;
     drainQueue() pushes the widget-saved nap to Baby Buddy
```

## Constraints (accepted)

- **Elapsed number lags.** Android refreshes widgets on its own cadence
  (`updatePeriodMillis` ≥ 30 min) unless something calls `requestWidgetUpdate`.
  Each tap re-renders immediately, so the **state** (Idle ↔ Napping) is always
  correct at once; the ticking `12:34` won't advance second-by-second between
  system updates. Same limitation the Status widget's "Napping" row already has.
  Minute resolution, refreshed on touch and when the app pushes updates.
- **App foreground during a widget tap.** The headless task writes AsyncStorage;
  a running app reconciles timers/queue on its next focus/resume. Brief,
  harmless divergence.
- **Demo / unconfigured:** the local timer still toggles, but no entry is queued
  (nothing to sync to). Documented, not a crash.

## Error handling

- All AsyncStorage reads/writes reuse the existing guarded (try/catch-to-no-op)
  helpers in `timers.ts`, `queue.ts`, and `snapshot.ts`; failures degrade to
  no-ops, never crash the headless task.
- A stop with no resolvable `childId` skips the queue write rather than enqueuing
  a malformed entry.
- `requestWidgetUpdate`/render failures are swallowed as they are today
  (`pushWidgetUpdate` already wraps in try/catch).

## Testing

- Unit tests for `startSleepTimer` / `buildSleepEntry` and `toggleNapFromWidget`
  (above) via vitest.
- Manual verification on Android: add the Nap widget; tap to start (flips to
  Napping, and the Timers screen shows the running timer on next app open); tap
  to stop (resets to idle, and the nap appears in the log / syncs to Baby Buddy);
  confirm the Status widget is unaffected.
