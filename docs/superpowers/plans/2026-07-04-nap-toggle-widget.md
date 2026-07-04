# Nap Toggle Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second Android home-screen widget whose whole surface is a nap start/stop toggle, handled headless — tap starts a sleep timer in place, tap again stops and saves the nap via the existing offline queue, without ever opening the app.

**Architecture:** The toggle logic is pure and shared: `startSleepTimer`/`buildSleepEntry` live in a small data module the store and the widget both call, so they build byte-identical timers/entries. The widget task handler catches the `NAP_TOGGLE` click, runs a headless orchestrator (`toggleNapFromWidget`) that mutates the same AsyncStorage the app reads (`babybuddy.timers.v1`, `babybuddy.queue.v1`, `babybuddy.widget.v1`), then re-renders. The app drains the queue on next open like any offline write.

**Tech Stack:** Expo SDK 56, React Native, TypeScript (strict), `react-native-android-widget`, AsyncStorage, Zustand store, Vitest.

## Global Constraints

- **Expo SDK v56** — consult `https://docs.expo.dev/versions/v56.0.0/` before writing framework code (per `AGENTS.md`).
- **Android-only widget.** Non-Android paths stay no-ops (mirrors the existing `pushWidgetUpdate`/`register` `.android` split).
- **No new dependencies.** Reuse `react-native-android-widget`, AsyncStorage, and the existing guarded I/O helpers in `src/data/timers.ts`, `src/data/queue.ts`, `src/widgets/snapshot.ts`.
- **Minute resolution.** The napping elapsed time uses `fmtDur` (minutes); Android only refreshes widgets on tap + its own ≥30-min cadence. State (Idle ↔ Napping) is always correct immediately after a tap; the number lags — this is accepted, same as the Status widget.
- **Nap-only.** The widget saves `type: 'sleep'` entries; it does not touch feeding/pumping/tummy timers.
- **Test command:** `npm test` (all) or `npx vitest run <file>` (one file). **Typecheck:** `npx tsc --noEmit`. **Lint:** `npm run lint`.
- **The existing Status widget must remain byte-for-byte behaviorally unchanged.**

---

## File Structure

- **Create** `src/data/sleepTimer.ts` — pure `startSleepTimer` / `buildSleepEntry` builders shared by store + widget.
- **Create** `src/data/sleepTimer.test.ts` — unit tests for the builders.
- **Modify** `src/store/useAppStore.ts` — `stopTimer` sleep branch calls `buildSleepEntry` (one source of truth).
- **Modify** `src/widgets/snapshot.ts` — add `selectedChildId` + `canQueueNap` to `WidgetSnapshot` and `buildWidgetSnapshot`.
- **Create** `src/widgets/snapshot.test.ts` — tests for the two new fields.
- **Create** `src/widgets/napToggle.ts` — headless `toggleNapFromWidget(now)` orchestrator.
- **Create** `src/widgets/napToggle.test.ts` — start/stop/demo behavior with an in-memory AsyncStorage.
- **Create** `src/widgets/NapWidget.tsx` — the single-purpose toggle widget UI.
- **Modify** `src/widgets/widgetTaskHandler.tsx` — route by `widgetName`; handle `WIDGET_CLICK` / `NAP_TOGGLE`.
- **Modify** `app.json` — register the second `"Nap"` widget in the `react-native-android-widget` plugin config.

---

### Task 1: Shared sleep-timer builders + adopt in `stopTimer`

**Files:**
- Create: `src/data/sleepTimer.ts`
- Test: `src/data/sleepTimer.test.ts`
- Modify: `src/store/useAppStore.ts` (sleep branch of `stopTimer`, ~line 912-915; add an import near the other `@/data/*` imports ~line 27)

**Interfaces:**
- Produces: `startSleepTimer(now: number): Timer` and `buildSleepEntry(timer: Timer, now: number, childId: string): SleepEntry`.
- Consumes: `ACTIVITY_LABEL` from `@/lib/activities`; `Timer`, `SleepEntry` from `@/types/models`.

- [ ] **Step 1: Write the failing test**

Create `src/data/sleepTimer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { buildSleepEntry, startSleepTimer } from '@/data/sleepTimer';
import type { Timer } from '@/types/models';

describe('startSleepTimer', () => {
  it('creates a running sleep timer starting at now', () => {
    const t = startSleepTimer(1000);
    expect(t).toMatchObject({ activity: 'sleep', saveAs: 'sleep', name: 'Sleep', start: 1000 });
    expect(t.id).toBe('t1000');
  });
});

describe('buildSleepEntry', () => {
  const base: Timer = { id: 't1', activity: 'sleep', name: 'Sleep', start: 1000, saveAs: 'sleep' };

  it('spans the timer start to now and stamps the child', () => {
    const e = buildSleepEntry(base, 5000, 'c1');
    expect(e).toMatchObject({ type: 'sleep', start: 1000, end: 5000, childId: 'c1', tags: [] });
    expect(e.id).toBe('e5000');
  });

  it('derives nap=true during the day and false at night', () => {
    const noon = new Date(2026, 0, 1, 12, 0, 0).getTime();
    const night = new Date(2026, 0, 1, 2, 0, 0).getTime();
    expect(buildSleepEntry(base, noon, 'c1').nap).toBe(true);
    expect(buildSleepEntry(base, night, 'c1').nap).toBe(false);
  });

  it('honors an explicit nap flag on the timer', () => {
    const noon = new Date(2026, 0, 1, 12, 0, 0).getTime();
    expect(buildSleepEntry({ ...base, nap: false }, noon, 'c1').nap).toBe(false);
  });

  it('carries the timer tags', () => {
    expect(buildSleepEntry({ ...base, tags: ['x'] }, 5000, 'c1').tags).toEqual(['x']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/sleepTimer.test.ts`
Expected: FAIL — cannot resolve `@/data/sleepTimer` (module not found).

- [ ] **Step 3: Write the minimal implementation**

Create `src/data/sleepTimer.ts`:

```ts
/**
 * Pure builders for the sleep timer, shared by the store (`stopTimer`) and the
 * headless widget toggle (`toggleNapFromWidget`) so both produce byte-identical
 * timers and entries. No I/O — trivially testable.
 */

import { ACTIVITY_LABEL } from '@/lib/activities';
import type { SleepEntry, Timer } from '@/types/models';

/** A fresh running sleep timer starting at `now` (epoch ms). */
export function startSleepTimer(now: number): Timer {
  return {
    id: 't' + now,
    activity: 'sleep',
    name: ACTIVITY_LABEL.sleep,
    start: now,
    saveAs: 'sleep',
  };
}

/**
 * Build the finished nap entry for a stopped sleep timer. Mirrors the sleep
 * branch of the store's `stopTimer`: `nap` defaults from the hour of day unless
 * the timer carries an explicit flag; tags carry through.
 */
export function buildSleepEntry(timer: Timer, now: number, childId: string): SleepEntry {
  const hr = new Date(now).getHours();
  return {
    id: 'e' + now,
    childId,
    tags: timer.tags ?? [],
    type: 'sleep',
    start: timer.start,
    end: now,
    nap: timer.nap ?? (hr >= 7 && hr < 19),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/data/sleepTimer.test.ts`
Expected: PASS (5 assertions across 2 describes).

- [ ] **Step 5: Adopt the helper in `stopTimer`**

In `src/store/useAppStore.ts`, add the import alongside the other `@/data/*` imports (near line 27, e.g. under the `@/data/queue` import):

```ts
import { buildSleepEntry } from '@/data/sleepTimer';
```

Then replace the sleep branch of `stopTimer`. Find this block (~lines 912-915):

```ts
    } else {
      const hr = new Date().getHours();
      entry = { ...base, type: 'sleep', start: tm.start, end: now, nap: tm.nap ?? (hr >= 7 && hr < 19) };
    }
```

Replace it with:

```ts
    } else {
      entry = buildSleepEntry(tm, now, s.selectedChildId);
    }
```

(`base` already sets `id: 'e' + now`, `childId: s.selectedChildId`, and `tags: savedTags = tm.tags ?? []` — `buildSleepEntry` reconstructs the identical values, so the entry is unchanged.)

- [ ] **Step 6: Run the full suite to verify no regression**

Run: `npm test`
Expected: PASS — all existing tests (including `stopTimer` tests in `src/store/useAppStore.test.ts`) still green, plus the new `sleepTimer` tests.

- [ ] **Step 7: Commit**

```bash
git add src/data/sleepTimer.ts src/data/sleepTimer.test.ts src/store/useAppStore.ts
git commit -m "refactor(timers): extract shared startSleepTimer/buildSleepEntry helpers"
```

---

### Task 2: Snapshot gains `selectedChildId` + `canQueueNap`

**Files:**
- Modify: `src/widgets/snapshot.ts` (the `WidgetSnapshot` interface, the `buildWidgetSnapshot` param type, and its return object)
- Test: `src/widgets/snapshot.test.ts` (create)

**Interfaces:**
- Consumes: `Connection` from `@/data/repository`.
- Produces: `WidgetSnapshot` now has `selectedChildId: string` and `canQueueNap: boolean`; `buildWidgetSnapshot` accepts a `connection: Connection | null` field on its state arg (satisfied automatically by `useAppStore.getState()` in `src/widgets/sync.ts`).

- [ ] **Step 1: Write the failing test**

Create `src/widgets/snapshot.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { Child } from '@/types/models';
import { buildWidgetSnapshot } from '@/widgets/snapshot';

const child: Child = { id: 'c1', first: 'Ada', last: 'L', birth: 0, color: '#ffffff' };
const baseState = { children: [child], selectedChildId: 'c1', entries: [], timers: [] };

describe('buildWidgetSnapshot child + queue fields', () => {
  it('passes through selectedChildId', () => {
    const s = buildWidgetSnapshot({ ...baseState, connection: { demo: false, serverUrl: 'http://x', token: 't' } });
    expect(s.selectedChildId).toBe('c1');
  });

  it('canQueueNap is true for a real connection', () => {
    const s = buildWidgetSnapshot({ ...baseState, connection: { demo: false, serverUrl: 'http://x', token: 't' } });
    expect(s.canQueueNap).toBe(true);
  });

  it('canQueueNap is false in demo mode', () => {
    const s = buildWidgetSnapshot({ ...baseState, connection: { demo: true, serverUrl: '', token: '' } });
    expect(s.canQueueNap).toBe(false);
  });

  it('canQueueNap is false with no connection', () => {
    const s = buildWidgetSnapshot({ ...baseState, connection: null });
    expect(s.canQueueNap).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/widgets/snapshot.test.ts`
Expected: FAIL — TypeScript/assertion error: `connection` not accepted on the param and/or `selectedChildId`/`canQueueNap` missing on the result.

- [ ] **Step 3: Add the import**

In `src/widgets/snapshot.ts`, add near the existing type imports:

```ts
import type { Connection } from '@/data/repository';
```

- [ ] **Step 4: Extend the `WidgetSnapshot` interface**

In the `WidgetSnapshot` interface, add these two fields (e.g. after `diapersToday`):

```ts
  /** id of the selected child — stamps entries created from the widget */
  selectedChildId: string;
  /** true when a real (non-demo) connection exists, so a widget-saved nap can be queued */
  canQueueNap: boolean;
```

- [ ] **Step 5: Accept `connection` in the builder and populate the fields**

Change the `buildWidgetSnapshot` param type to include `connection`:

```ts
export function buildWidgetSnapshot(s: {
  children: Child[];
  selectedChildId: string;
  entries: Entry[];
  timers: Timer[];
  connection: Connection | null;
}): WidgetSnapshot {
```

Then in the returned object literal, add:

```ts
    selectedChildId: s.selectedChildId,
    canQueueNap: !!s.connection && !s.connection.demo,
```

(No change is needed in `src/widgets/sync.ts`: it calls `buildWidgetSnapshot(useAppStore.getState())`, and the store state already carries `connection`.)

- [ ] **Step 6: Run the test + typecheck to verify they pass**

Run: `npx vitest run src/widgets/snapshot.test.ts`
Expected: PASS (4 assertions).
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/widgets/snapshot.ts src/widgets/snapshot.test.ts
git commit -m "feat(widget): add selectedChildId + canQueueNap to the widget snapshot"
```

---

### Task 3: Headless nap toggle orchestrator

**Files:**
- Create: `src/widgets/napToggle.ts`
- Test: `src/widgets/napToggle.test.ts`

**Interfaces:**
- Consumes: `startSleepTimer`, `buildSleepEntry` (Task 1); `WidgetSnapshot`, `readWidgetSnapshot`, `writeWidgetSnapshot` (Task 2 / existing); `loadTimers`, `saveTimers` from `@/data/timers`; `enqueueEntry` from `@/data/queue`.
- Produces: `toggleNapFromWidget(now: number): Promise<WidgetSnapshot | null>` — returns the snapshot to render (with `sleepStart` reflecting the new state), or `null` if no snapshot exists yet.

- [ ] **Step 1: Write the failing test**

Create `src/widgets/napToggle.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadQueue } from '@/data/queue';
import { loadTimers, saveTimers } from '@/data/timers';
import { toggleNapFromWidget } from '@/widgets/napToggle';
import { writeWidgetSnapshot, type WidgetSnapshot } from '@/widgets/snapshot';

// In-memory stand-in for the native AsyncStorage module (same pattern as timers.test.ts).
const mem = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => mem.store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      mem.store.set(k, v);
    }),
    removeItem: vi.fn(async (k: string) => {
      mem.store.delete(k);
    }),
  },
}));

const snap = (over: Partial<WidgetSnapshot> = {}): WidgetSnapshot => ({
  childName: 'Ada',
  birth: null,
  lastFeedEnd: null,
  nextSide: 'left',
  lastDiaper: null,
  lastDiaperSolid: false,
  sleepStart: null,
  sleepTodayMin: 0,
  feedsToday: 0,
  diapersToday: 0,
  selectedChildId: 'c1',
  canQueueNap: true,
  ...over,
});

beforeEach(() => {
  mem.store.clear();
});

describe('toggleNapFromWidget', () => {
  it('returns null when there is no snapshot yet', async () => {
    expect(await toggleNapFromWidget(1000)).toBeNull();
  });

  it('start: creates a sleep timer and sets sleepStart, queues nothing', async () => {
    await writeWidgetSnapshot(snap());
    const next = await toggleNapFromWidget(1000);
    expect(next?.sleepStart).toBe(1000);
    const timers = await loadTimers();
    expect(timers).toHaveLength(1);
    expect(timers[0]).toMatchObject({ activity: 'sleep', start: 1000 });
    expect(await loadQueue()).toHaveLength(0);
  });

  it('stop: queues the nap, clears the timer, clears sleepStart', async () => {
    await writeWidgetSnapshot(snap({ sleepStart: 1000 }));
    await saveTimers([{ id: 't1', activity: 'sleep', name: 'Sleep', start: 1000, saveAs: 'sleep' }]);
    const next = await toggleNapFromWidget(5000);
    expect(next?.sleepStart).toBeNull();
    expect(await loadTimers()).toHaveLength(0);
    const q = await loadQueue();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ type: 'sleep', start: 1000, end: 5000, childId: 'c1' });
  });

  it('stop in demo mode: clears the timer but queues nothing', async () => {
    await writeWidgetSnapshot(snap({ sleepStart: 1000, canQueueNap: false }));
    await saveTimers([{ id: 't1', activity: 'sleep', name: 'Sleep', start: 1000, saveAs: 'sleep' }]);
    const next = await toggleNapFromWidget(5000);
    expect(next?.sleepStart).toBeNull();
    expect(await loadTimers()).toHaveLength(0);
    expect(await loadQueue()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/widgets/napToggle.test.ts`
Expected: FAIL — cannot resolve `@/widgets/napToggle`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/widgets/napToggle.ts`:

```ts
/**
 * Headless nap start/stop toggle for the home-screen widget. Runs inside the
 * widget task handler (no app, no store), mutating the same AsyncStorage the app
 * reads: start appends a sleep timer; stop appends the finished nap to the
 * offline queue (drained by the app on next open) and clears the timer. Returns
 * the snapshot the caller should render.
 */

import { enqueueEntry } from '@/data/queue';
import { buildSleepEntry, startSleepTimer } from '@/data/sleepTimer';
import { loadTimers, saveTimers } from '@/data/timers';
import { readWidgetSnapshot, writeWidgetSnapshot, type WidgetSnapshot } from '@/widgets/snapshot';

export async function toggleNapFromWidget(now: number): Promise<WidgetSnapshot | null> {
  const snap = await readWidgetSnapshot();
  if (!snap) return null; // no snapshot yet (widget added before first app launch) — nothing to toggle

  const timers = await loadTimers();
  const running = timers.find((t) => t.activity === 'sleep');

  if (running) {
    // Stop: queue the finished nap (unless demo/unconfigured) and drop the timer.
    if (snap.canQueueNap && snap.selectedChildId) {
      await enqueueEntry(buildSleepEntry(running, now, snap.selectedChildId));
    }
    await saveTimers(timers.filter((t) => t !== running));
    const next: WidgetSnapshot = { ...snap, sleepStart: null };
    await writeWidgetSnapshot(next);
    return next;
  }

  // Start: append a running sleep timer in place.
  await saveTimers([...timers, startSleepTimer(now)]);
  const next: WidgetSnapshot = { ...snap, sleepStart: now };
  await writeWidgetSnapshot(next);
  return next;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/widgets/napToggle.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/widgets/napToggle.ts src/widgets/napToggle.test.ts
git commit -m "feat(widget): headless nap start/stop toggle via the offline queue"
```

---

### Task 4: `NapWidget` UI component

**Files:**
- Create: `src/widgets/NapWidget.tsx`

**Interfaces:**
- Consumes: `WidgetSnapshot` (reads only `sleepStart`); `fmtDur` from `@/lib/format`; `activitySvg` from `@/widgets/widgetIcons`; `FlexWidget`/`SvgWidget`/`TextWidget` from `react-native-android-widget`.
- Produces: `NapWidget({ snapshot, now }): JSX` — the whole surface has `clickAction="NAP_TOGGLE"`.

*(No vitest test: `react-native-android-widget` JSX cannot render in the node test env — `StatusWidget.tsx` has no unit test either. Verification is typecheck + lint here, and on-device in Task 5.)*

- [ ] **Step 1: Write the component**

Create `src/widgets/NapWidget.tsx`:

```tsx
'use no memo';

// Android home-screen widget: a single nap start/stop toggle. The whole surface
// is one tap target (clickAction NAP_TOGGLE), handled headless in the widget
// task handler — tapping never opens the app. `now` is passed in (not read in
// render) to keep the render pure, mirroring StatusWidget.

import { FlexWidget, SvgWidget, TextWidget } from 'react-native-android-widget';

import { fmtDur } from '@/lib/format';
import type { WidgetSnapshot } from '@/widgets/snapshot';
import { activitySvg } from '@/widgets/widgetIcons';

type Hex = `#${string}`;

const BG: Hex = '#16110E';
const TEXT: Hex = '#F3EBE1';
const SLEEP: Hex = '#A99EDC';

export function NapWidget({ snapshot, now }: { snapshot: WidgetSnapshot | null; now: number }) {
  const sleepStart = snapshot?.sleepStart ?? null;
  const napping = sleepStart != null;
  const elapsed = napping ? fmtDur((now - sleepStart) / 60000) : '';

  return (
    <FlexWidget
      clickAction="NAP_TOGGLE"
      accessibilityLabel={napping ? 'Stop nap' : 'Start nap'}
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: napping ? SLEEP : BG,
        borderRadius: 24,
        padding: 12,
      }}
    >
      {napping ? (
        <FlexWidget style={{ flexDirection: 'column', alignItems: 'center' }}>
          <TextWidget text="● Napping" style={{ fontSize: 14, fontWeight: 'bold', color: BG }} />
          <TextWidget text={elapsed} style={{ fontSize: 26, fontWeight: 'bold', color: BG, marginTop: 2 }} />
          <TextWidget text="tap to stop" style={{ fontSize: 12, color: BG, marginTop: 2 }} />
        </FlexWidget>
      ) : (
        <FlexWidget style={{ flexDirection: 'column', alignItems: 'center' }}>
          <SvgWidget svg={activitySvg('sleep', SLEEP)} style={{ height: 34, width: 34 }} />
          <TextWidget text="Start nap" style={{ fontSize: 16, fontWeight: 'bold', color: TEXT, marginTop: 6 }} />
        </FlexWidget>
      )}
    </FlexWidget>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run lint`
Expected: no errors for `src/widgets/NapWidget.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/widgets/NapWidget.tsx
git commit -m "feat(widget): NapWidget start/stop toggle UI"
```

---

### Task 5: Route the task handler + register the widget

**Files:**
- Modify: `src/widgets/widgetTaskHandler.tsx`
- Modify: `app.json` (the `react-native-android-widget` plugin `widgets` array)

**Interfaces:**
- Consumes: `NapWidget` (Task 4); `toggleNapFromWidget` (Task 3); `StatusWidget`, `readWidgetSnapshot` (existing); `WidgetTaskHandlerProps` (`widgetInfo.widgetName`, `widgetAction`, `clickAction`).

- [ ] **Step 1: Rewrite the task handler to route by widget name and handle the tap**

Replace the entire body of `src/widgets/widgetTaskHandler.tsx` with:

```tsx
'use no memo';

import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import { NapWidget } from '@/widgets/NapWidget';
import { toggleNapFromWidget } from '@/widgets/napToggle';
import { readWidgetSnapshot } from '@/widgets/snapshot';
import { StatusWidget } from '@/widgets/StatusWidget';

/** Headless handler: renders each widget from the persisted snapshot, and runs
 *  the Nap widget's in-place start/stop toggle on tap (no app open). */
export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  const now = Date.now();

  // Nap widget tapped: toggle start/stop in place, then re-render it.
  if (props.widgetAction === 'WIDGET_CLICK' && props.clickAction === 'NAP_TOGGLE') {
    const snapshot = await toggleNapFromWidget(now);
    props.renderWidget(<NapWidget snapshot={snapshot} now={now} />);
    return;
  }

  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED': {
      const snapshot = await readWidgetSnapshot();
      props.renderWidget(
        props.widgetInfo.widgetName === 'Nap' ? (
          <NapWidget snapshot={snapshot} now={now} />
        ) : (
          <StatusWidget snapshot={snapshot} now={now} />
        ),
      );
      break;
    }
    default:
      break;
  }
}
```

- [ ] **Step 2: Register the second widget in `app.json`**

In `app.json`, inside `plugins` → the `"react-native-android-widget"` entry → `"widgets"` array, add a second object after the existing `"Status"` widget object (keep the `Status` object unchanged):

```json
            {
              "name": "Nap",
              "label": "Nap timer",
              "minWidth": "110dp",
              "minHeight": "110dp",
              "targetCellWidth": 2,
              "targetCellHeight": 1,
              "description": "Start / stop a nap",
              "previewImage": "./assets/images/icon.png",
              "updatePeriodMillis": 1800000
            }
```

(The array element separator: add a comma after the closing `}` of the `Status` object.)

- [ ] **Step 3: Verify the config is valid JSON + everything typechecks and tests pass**

Run: `node -e "JSON.parse(require('fs').readFileSync('app.json','utf8')); console.log('app.json OK')"`
Expected: `app.json OK`.
Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm test`
Expected: PASS — all suites green.
Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/widgets/widgetTaskHandler.tsx app.json
git commit -m "feat(widget): register the Nap widget and route its toggle tap"
```

- [ ] **Step 5: Manual on-device verification (Android build required)**

This is the only way to see the widget render/tick — vitest cannot exercise `react-native-android-widget`. Build and install a dev/EAS Android build (`npx expo run:android` or an EAS build), then:

1. Long-press the home screen → Widgets → Budkin → add the **"Nap timer"** widget.
2. **Tap while idle** → it flips to the purple "Napping · <time>" state; open the app → the running sleep timer appears on the Timers screen.
3. **Tap while napping** → it resets to "Start nap"; open the app → the nap appears in the log and syncs to Baby Buddy (or shows "queued offline" if offline).
4. Confirm the existing **Status** widget still renders and its buttons still open the app.
5. In demo mode: the toggle still flips visually, but no entry is queued.

---

## Self-Review

**Spec coverage:**
- Dedicated single-purpose widget → Task 4 (`NapWidget`) + Task 5 (registration). ✓
- Tap idle → start in place; tap napping → stop & save; headless/no app open → Task 3 (`toggleNapFromWidget`) + Task 5 (handler routing). ✓
- Silent save via existing offline queue → Task 3 (`enqueueEntry`). ✓
- Source of truth on tap is `loadTimers()` → Task 3. ✓
- Shared pure helpers `startSleepTimer` / `buildSleepEntry` factored out of `stopTimer` → Task 1. ✓
- Snapshot gains `selectedChildId` + `canQueueNap` → Task 2. ✓
- Demo / unconfigured skips the queue write → Task 3 (guard) + Task 2 (`canQueueNap`). ✓
- Status widget untouched → Task 5 keeps the `Status` branch/registration as-is; verified in Step 5.4. ✓
- Minute-resolution / update-cadence constraint → documented in Global Constraints and Task 4 uses `fmtDur`. ✓

**Placeholder scan:** No TBD/TODO; every code step contains full code; every command has expected output. ✓

**Type consistency:** `startSleepTimer(now)`, `buildSleepEntry(timer, now, childId)`, `toggleNapFromWidget(now)`, and `WidgetSnapshot`'s new `selectedChildId`/`canQueueNap` fields are used identically across Tasks 1→3→5. `Connection` imported from `@/data/repository` matches its definition. ✓
