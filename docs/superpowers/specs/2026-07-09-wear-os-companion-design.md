# Wear OS companion (tethered watch app)

**Date:** 2026-07-09
**Status:** Architecture approved during brainstorming; MVP scope agreed. Not yet
planned. Several native specifics deliberately deferred to planning (see **Open
questions for planning**).

## Problem

The phone app already makes quick baby actions glanceable *on the phone* — the
`Nap` home-screen widget starts/stops a sleep timer in place, and the `Status`
widget shows time-since-last-event and opens the app to log. But the common
moment — baby asleep on you, phone across the room — is exactly when the phone
isn't in reach. A smartwatch is. The ask: start/stop a nap timer and log a
diaper (and, over time, feeding + a status glance) from the wrist, without
pulling out the phone.

## Goal

A **Wear OS companion app**, tethered to the phone, that surfaces the same quick
actions the phone widgets do. The phone remains the single source of truth and
the **only** writer to Baby Buddy; the watch only sends intents and renders a
snapshot the phone pushes to it.

**Eventual (full) scope** — nap start/stop, log diaper (wet/solid/both), feeding
timer (type + method), status glance.

**MVP scope (this spec's build target)** — the *entire pipeline* end-to-end, but
with the smallest action surface:

- A **Wear Tile** with **nap start/stop** (one toggle) + a **status glance**
  (child name, nap running + elapsed, time since last feed/diaper).
- The **phone↔watch bridge** (both directions) and the **snapshot** that feeds
  the Tile.
- The **headless-when-closed** path proven for nap-toggle specifically (the
  riskiest requirement — see Risks).

Diaper and feeding actions, the companion Compose app, and the watch-face
complication are explicitly **phase 2+**, deferred until the MVP pipeline is
trusted. The native setup cost is a one-time fixed cost regardless of how many
actions ship, so proving it on the thinnest surface de-risks everything after.

## Non-goals

- **Not standalone.** The watch never talks to the Baby Buddy server directly,
  never stores a token, never re-implements the API client. All writes go
  through the phone. (Rejected during brainstorming — see Decisions.)
- **No new write logic.** The watch triggers the *existing* phone code paths
  (`@/data/*`); it does not introduce a second way to build/queue entries.
- **No multi-child switching on the watch (MVP).** The watch acts on whichever
  child is selected on the phone. Switching stays a phone action.
- **No editing** entries from the watch (start time, notes, tags). Edit in the
  app afterward, like any offline write.
- **iOS/web:** no-op. This is an Android/Wear-only surface, consistent with the
  existing Android-only widgets.
- **Not a full mirror of the app UI.** Glanceable quick actions only; browsing
  history, insights, and settings stay on the phone.

## Decisions (resolved during brainstorming)

- **Tethered, not standalone.** Watch → phone over the Wearable **Data Layer**;
  phone → Baby Buddy. Reuses the phone's offline queue, timer model, auth, and
  API client wholesale. Bluetooth range (~10 m) is acceptable for the home use
  case. Standalone was rejected: it would duplicate auth + the API client + a
  queue in Kotlin on the watch, and a self-hosted Baby Buddy server is often only
  reachable on the home LAN anyway.
- **The watch reuses the phone's existing `@/data` code paths.** A nap toggle
  from the watch runs the *same* logic as `toggleNapFromWidget`
  (`src/widgets/napToggle.ts`): start/stop the sleep timer via
  `loadTimers`/`saveTimers`, `enqueueEntry(buildSleepEntry(...))` into the
  offline queue (`@/data/queue`), post the timer notification. The watch inherits
  offline resilience for free.
- **The phone→watch snapshot is the existing `WidgetSnapshot`, re-serialized.**
  One snapshot shape (`src/widgets/snapshot.ts`) feeds both the home widgets and
  the watch Tile. No parallel state model.
- **Leave the Expo-managed workflow by committing `android/`.** Run
  `expo prebuild` once, check the generated `android/` project into git, add the
  Wear Gradle module by hand, and stop regenerating. Chosen over a custom
  config-plugin (dangerous mods injecting the module every prebuild) because the
  app is already native-heavy (widgets, notifications, secure-store) and a hand-
  owned `android/` is simpler to reason about than fragile prebuild plumbing.
- **Same package + same signing key.** The Wear module ships under the existing
  package `dev.karellievens.budkin` and must be signed with the same key as
  the phone app — a hard requirement of the RN↔Wear bridge libraries and of
  Play's Wear distribution.
- **Thin MVP first.** Build the whole pipeline with only nap-toggle + status,
  then add diaper/feeding once the plumbing (especially headless-when-closed) is
  trusted.

## Architecture

Three pieces. The phone is the only writer to Baby Buddy; the watch is a remote
trigger + a renderer of pushed state.

```
┌──────────────────┐   Wearable Data Layer (BLE via Play Services)   ┌────────────────────┐
│  WATCH (new)      │ ── MessageClient: action intents ────────────▶ │  PHONE (existing RN) │ ──▶ Baby Buddy
│  Kotlin/Compose   │ ◀─ DataClient: WidgetSnapshot DataItem ──────  │  @/data/* + queue    │     server (via
│  Tile (+ app L8r) │                                                │  + WearableListener  │     existing sync)
└──────────────────┘                                                └────────────────────┘
```

### 1. Phone-side bridge — receive intents, push snapshot

- **Transport library.** Adopt an existing RN↔Wear Data Layer library rather
  than hand-writing JNI. Candidates:
  [`Turtlepaw/react-native-wear`](https://github.com/Turtlepaw/react-native-wear)
  (an Expo native module wrapping the Data Client API) and
  [`react-native-wear-connectivity`](https://github.com/fabOnReact/react-native-wear-connectivity)
  (`sendMessage()` / `watchEvents`). Final choice + maturity assessment is a
  planning task (see Open questions).
- **Watch → phone messages** are small, e.g. `{ action: "NAP_TOGGLE" }`; phase 2
  adds `{ action: "LOG_DIAPER", type }` and `{ action: "FEED_START"|"FEED_STOP",
  feedType, method }`. Each maps to exactly one existing `@/data` operation.
- **Phone → watch** publishes the current `WidgetSnapshot` as a Data Layer
  `DataItem` whenever the app pushes a widget update. Reuse the existing sync
  trigger point in `src/widgets/sync.ts` — the watch becomes one more subscriber
  to the same snapshot the home widgets already receive.

### 2. Headless-when-closed handler (the crux)

For nap-toggle to work with the RN app killed — the whole point of glanceability
— the intent must be handled without a foreground JS context.

- A native **`WearableListenerService`** (registered in the committed
  `android/` manifest) receives the Data Layer message even when the app is not
  running.
- It **starts a headless JS task** that runs the *existing* `@/data` logic — the
  same mechanism `react-native-android-widget` already uses to run
  `toggleNapFromWidget` headlessly. The handler calls the shared toggle logic so
  the watch, the home widget, and the app all produce byte-identical timers and
  entries.
- After mutating AsyncStorage (timer + offline queue + snapshot), it **publishes
  the updated `WidgetSnapshot` back** to the Data Layer so the watch Tile
  re-renders to the new state.

This path is the single most important thing the MVP proves. An acceptable
interim step during the MVP build is to first prove the round trip with the app
**foregrounded** (library-only, no headless service), then layer the
`WearableListenerService` + headless task on top — so a bridge failure and a
background-execution failure are debugged separately, not at once.

### 3. Watch module — Wear Tile (MVP), Compose app (phase 2)

- **New Gradle module** `wear/` inside the committed `android/`, package
  `dev.karellievens.budkin`, same signing config as the phone app.
- **Tile** (Jetpack Tiles / ProtoLayout, Kotlin): the swipeable card — the watch
  analog of the `Nap`/`Status` home widgets.
  - **Nap toggle button:** tap sends `NAP_TOGGLE`; label reflects snapshot state
    ("Start nap" ↔ "Napping · <elapsed> · tap to stop"), mirroring the phone
    widget's labels.
  - **Status glance:** child name, nap running + elapsed, time since last
    feed/diaper — all read from the pushed `WidgetSnapshot`.
  - Renders from the last snapshot; a tap sends the intent and optimistically
    updates, then reconciles when the phone pushes the authoritative snapshot.
- **Companion Compose app (phase 2):** the surface for actions a Tile's few
  buttons can't disambiguate — diaper wet/solid/both, feed type/method, and
  confirmations.
- **Complication (later):** nap-running elapsed on the watch face.

### 4. Build / release

- `expo prebuild` once → commit `android/`; stop regenerating (documented in
  `RUNNING.md`).
- Add the `wear/` module + Wear dependencies (Tiles, ProtoLayout,
  play-services-wearable) to Gradle; wire shared signing.
- Wear app distributed via the same Play listing as the phone app (same package,
  same key).

## Data flow (MVP, nap toggle)

```
watch Tile tap (idle)
  -> MessageClient send { action: "NAP_TOGGLE" }
     -> phone WearableListenerService receives (app may be closed)
        -> headless JS task: shared nap-toggle logic
           loadTimers() -> no sleep timer
           saveTimers([...timers, startSleepTimer(now)])
           writeWidgetSnapshot({ ...snap, sleepStart: now })
        -> publish updated WidgetSnapshot DataItem
     -> watch Tile re-renders -> "Napping · 0:00 · tap to stop"

watch Tile tap (napping)
  -> { action: "NAP_TOGGLE" }
     -> headless task: shared logic
        loadTimers() -> running sleep timer
        if snap.canQueueNap && snap.selectedChildId:
          enqueueEntry(buildSleepEntry(running, now, snap.selectedChildId))
        saveTimers(without running); writeWidgetSnapshot({ ...snap, sleepStart: null })
     -> publish snapshot -> watch Tile resets to "Start nap"

app next open
  -> hydrate(): the watch-started/stopped timer + queued nap are already in
     AsyncStorage; drainQueue() syncs the nap to Baby Buddy — identical to the
     home-widget path today.
```

## Effort estimate (MVP)

For a developer comfortable with Kotlin; add ramp-up time if learning Wear OS.

| Chunk | Est. |
|---|---|
| `expo prebuild` → commit `android/`, add `wear/` Gradle module, shared signing | 1–2 days |
| Phone-side bridge (adopt library + `WearableListenerService`) | 2–4 days |
| Headless-when-closed JS task running shared `@/data` logic | 2–4 days ⚠️ |
| Wear Tile (Compose/ProtoLayout) + snapshot render + toggle intent | 3–5 days |
| Real-device testing, ambient mode, signing/release, Play Wear listing | 2–4 days |

**MVP ≈ 2–3 focused weeks.** Full four-action mirror (diaper + feeding +
companion app): **+1–2 weeks**.

## Constraints (accepted)

- **Phone must be in Bluetooth range.** Tethered by design. Out of range → the
  tap can't be delivered; the Tile shows stale state until reconnect. Acceptable
  for the home use case.
- **Snapshot latency / stale glance.** The Tile renders the last pushed snapshot;
  between pushes, elapsed times are minute-resolution and can lag, exactly like
  the home widgets today. A tap re-renders state immediately; the ticking number
  is not second-accurate.
- **Leaving CNG.** Once `android/` is committed and hand-owned, every Expo SDK
  upgrade is more manual. Accepted trade-off given the app's existing native
  surface.
- **Maintenance.** The project now carries Kotlin (Wear module + listener
  service) alongside the RN app.

## Risks (ordered by likelihood of biting)

1. **Headless-when-closed reliability.** The bridge libraries handle messaging
   *while the RN app runs*; running the toggle with the app killed needs the
   `WearableListenerService` + headless JS task, and OEM battery-killers / Doze
   can starve background execution. **This is why the MVP proves this path
   first.**
2. **Bridge library maturity.** These are small community libraries; one may need
   forking or supplementary native code. Assess before committing (Open
   questions).
3. **Testing needs real hardware.** The emulator is fine for Tile layout but poor
   for Data Layer / BLE pairing; a physical watch is effectively required for
   integration testing.
4. **Play Store.** Wear apps have their own review and quality bar; the same-
   package/same-key constraint must hold end to end.

## Open questions for planning

Crisp decisions the implementation plan must resolve before code:

1. **Which bridge library** — `react-native-wear` vs `react-native-wear-connectivity`
   vs a thin custom Expo module — judged on: does it support receiving messages
   via a `WearableListenerService` when the app is closed, or only in-process?
2. **Headless mechanism** — reuse `react-native-android-widget`'s headless task
   registration for the watch handler, or register a dedicated headless task?
3. **Expo v56 prebuild specifics** — confirm the exact `expo prebuild` → commit
   flow and Gradle `wear/` module wiring against the versioned docs
   (https://docs.expo.dev/versions/v56.0.0/) before writing native code, per
   `AGENTS.md`.
4. **Snapshot serialization** — publish `WidgetSnapshot` as a JSON `DataItem`, and
   confirm every Tile-needed field (child name, `sleepStart`, last feed/diaper
   times) is already present or add it once (shared with the home widgets).

## Testing

- **Unit (phone, vitest):** the shared nap-toggle logic already has coverage
  (`src/widgets/napToggle.test.ts`, `src/widgets/snapshot.test.ts`); extend only
  if the toggle is refactored to be shared with the watch handler. Snapshot
  serialization to/from the Data Layer payload gets its own pure test.
- **Manual, on a real paired watch:**
  - Nap start from the Tile with the **app closed** → app on next open shows the
    running timer, and the nap syncs to Baby Buddy on stop (proves the headless
    path — the primary MVP acceptance criterion).
  - Start on watch → stop on phone (and vice versa) stay consistent (single
    source of truth holds).
  - Status glance matches the phone's Status widget.
  - Out-of-range behavior degrades to a stale glance, not a crash.
