# Per-timer ongoing notifications (Android) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a timer runs, show one always-active (sticky) Android notification per running timer; tapping it opens the app's timers page. No action buttons.

**Architecture:** A store subscriber (`initTimerNotificationSync`, a twin of the existing `initWidgetSync`) reconciles the notification tray from `state.timers` on every change — posting/updating/dismissing one sticky notification per running timer. All native `expo-notifications` calls are isolated behind Metro's `.android.ts` platform-split files, with no-op `.ts` stubs for web/iOS; the reconcile brains live in a pure, unit-tested `content.ts`.

**Tech Stack:** Expo SDK 56, React Native 0.85, `expo-notifications`, expo-router, zustand, vitest.

## Global Constraints

- **Expo SDK 56 only.** Read `https://docs.expo.dev/versions/v56.0.0/` before touching native APIs. Verified API facts used below: `scheduleNotificationAsync({ identifier?, content, trigger })` with `trigger: null` = immediate; `content.sticky: true` = non-swipeable (Android); channel selection for immediate notifications is via the config plugin's `defaultChannel`; `setNotificationChannelAsync(id, { importance: Notifications.AndroidImportance.LOW })`; `dismissNotificationAsync(id)`; `getPermissionsAsync()/requestPermissionsAsync()` return `{ granted, canAskAgain }`; `addNotificationResponseReceivedListener(cb)` + `getLastNotificationResponseAsync()`; read data via `response.notification.request.content.data`.
- **Platform split by file extension, not `Platform.OS`.** Native code lives in `*.android.ts`; a plain `*.ts` stub serves web/iOS/vitest. Mirror `src/widgets/pushWidgetUpdate.{ts,android.tsx}` and `src/widgets/register.{ts,android.ts}`.
- **Android only.** iOS/web must cleanly no-op via the stubs.
- **No live-ticking clock** — static "Started H:MM AM/PM".
- **No action buttons** — tap-to-open only.
- **Notification identifier = `timer.id`** for deterministic post/update/dismiss.
- DRY, YAGNI, TDD, frequent commits. Use `@/…` path alias (vitest is configured for it).

## File Structure

- `src/notifications/content.ts` — **pure**: `TimerNotification` type, `formatClock`, `buildTimerNotification`, `desiredTimerNotifications`, `diffTimerNotifications`. Unit-tested.
- `src/notifications/content.test.ts` — vitest for the above.
- `src/notifications/postNotification.ts` — **stub** no-op `postTimerNotification`, `dismissTimerNotification`.
- `src/notifications/postNotification.android.ts` — **real** present/dismiss + permission gate.
- `src/notifications/register.ts` — **stub** (`export {}`).
- `src/notifications/register.android.ts` — **real**: create the `timers` channel + tap-response listener.
- `src/notifications/sync.ts` — `initTimerNotificationSync()` store subscriber (platform-agnostic; dispatches to the split post module).
- `index.ts` — add `import './src/notifications/register';`
- `src/app/_layout.tsx` — call `initTimerNotificationSync()` beside `initWidgetSync()`.
- `src/widgets/napToggle.ts` — post on nap start, dismiss on nap stop (widget/tray consistency).
- `src/widgets/napToggle.test.ts` — assert the post/dismiss calls.
- `app.json` — add `expo-notifications` plugin with `defaultChannel: "timers"`.

---

### Task 1: Pure notification content + reconcile diff

**Files:**
- Create: `src/notifications/content.ts`
- Test: `src/notifications/content.test.ts`

**Interfaces:**
- Consumes: `Timer` from `@/types/models`; `ACTIVITY_LABEL` from `@/lib/activities`.
- Produces:
  - `interface TimerNotification { identifier: string; title: string; body: string; data: { url: string; timerId: string } }`
  - `formatClock(ms: number): string`
  - `buildTimerNotification(timer: Timer, childName: string): TimerNotification`
  - `desiredTimerNotifications(timers: Timer[], childName: string): TimerNotification[]`
  - `diffTimerNotifications(prev: TimerNotification[], next: TimerNotification[]): { toPost: TimerNotification[]; toDismiss: string[] }`

- [ ] **Step 1: Write the failing test**

Create `src/notifications/content.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  buildTimerNotification,
  desiredTimerNotifications,
  diffTimerNotifications,
  formatClock,
  type TimerNotification,
} from '@/notifications/content';
import type { Timer } from '@/types/models';

// Build timestamps from a LOCAL Date so formatClock (local getHours/getMinutes)
// round-trips deterministically regardless of the machine's timezone.
const at = (h: number, m: number) => new Date(2026, 0, 1, h, m).getTime();

const timer = (over: Partial<Timer> = {}): Timer => ({
  id: 't1',
  activity: 'feeding',
  name: 'Feeding',
  start: at(14, 45),
  saveAs: 'feeding',
  ...over,
});

describe('formatClock', () => {
  it('formats afternoon as 12-hour with PM', () => {
    expect(formatClock(at(14, 45))).toBe('2:45 PM');
  });
  it('formats midnight hour as 12 AM and pads minutes', () => {
    expect(formatClock(at(0, 5))).toBe('12:05 AM');
  });
  it('formats noon as 12 PM', () => {
    expect(formatClock(at(12, 0))).toBe('12:00 PM');
  });
});

describe('buildTimerNotification', () => {
  it('shapes title/body/identifier/data from the timer and child', () => {
    expect(buildTimerNotification(timer(), 'Ellie')).toEqual({
      identifier: 't1',
      title: 'Ellie · Feeding',
      body: 'Started 2:45 PM',
      data: { url: '/timers', timerId: 't1' },
    });
  });
  it('uses saveAs (not activity) for the label', () => {
    expect(buildTimerNotification(timer({ saveAs: 'pumping' }), 'Ellie').title).toBe('Ellie · Pumping');
  });
  it('omits the separator when there is no child name', () => {
    expect(buildTimerNotification(timer(), '').title).toBe('Feeding');
  });
});

describe('diffTimerNotifications', () => {
  const a: TimerNotification = { identifier: 't1', title: 'Ellie · Feeding', body: 'Started 2:45 PM', data: { url: '/timers', timerId: 't1' } };

  it('posts brand-new notifications', () => {
    expect(diffTimerNotifications([], [a])).toEqual({ toPost: [a], toDismiss: [] });
  });
  it('is a no-op when content is unchanged', () => {
    expect(diffTimerNotifications([a], [a])).toEqual({ toPost: [], toDismiss: [] });
  });
  it('dismisses notifications whose timer is gone', () => {
    expect(diffTimerNotifications([a], [])).toEqual({ toPost: [], toDismiss: ['t1'] });
  });
  it('re-posts when the content changed for the same id', () => {
    const a2 = { ...a, body: 'Started 3:10 PM' };
    expect(diffTimerNotifications([a], [a2])).toEqual({ toPost: [a2], toDismiss: [] });
  });
});

describe('desiredTimerNotifications', () => {
  it('maps every timer to a notification', () => {
    const out = desiredTimerNotifications([timer(), timer({ id: 't2', saveAs: 'sleep' })], 'Ellie');
    expect(out.map((n) => n.identifier)).toEqual(['t1', 't2']);
    expect(out[1].title).toBe('Ellie · Sleep');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/notifications/content.test.ts`
Expected: FAIL — cannot resolve `@/notifications/content` / functions not defined.

- [ ] **Step 3: Write the implementation**

Create `src/notifications/content.ts`:

```ts
/**
 * Pure shaping + reconcile logic for per-timer Android notifications. No native
 * calls and no I/O, so it is trivially unit-testable. The store subscriber
 * (`sync.ts`) turns `state.timers` into the desired notification set here, diffs
 * it against what was last posted, and dispatches the post/dismiss work to the
 * platform-split module.
 */

import { ACTIVITY_LABEL } from '@/lib/activities';
import type { Timer } from '@/types/models';

export interface TimerNotification {
  /** stable id = timer.id, so posts update in place and dismissals are exact */
  identifier: string;
  title: string;
  body: string;
  data: { url: string; timerId: string };
}

/** "2:45 PM" — local 12-hour clock, timezone-agnostic in tests via local Date input. */
export function formatClock(ms: number): string {
  const d = new Date(ms);
  const ampm = d.getHours() >= 12 ? 'PM' : 'AM';
  let h = d.getHours() % 12;
  if (h === 0) h = 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
}

export function buildTimerNotification(timer: Timer, childName: string): TimerNotification {
  const label = ACTIVITY_LABEL[timer.saveAs];
  return {
    identifier: timer.id,
    title: childName ? `${childName} · ${label}` : label,
    body: `Started ${formatClock(timer.start)}`,
    data: { url: '/timers', timerId: timer.id },
  };
}

export function desiredTimerNotifications(timers: Timer[], childName: string): TimerNotification[] {
  return timers.map((t) => buildTimerNotification(t, childName));
}

export function diffTimerNotifications(
  prev: TimerNotification[],
  next: TimerNotification[],
): { toPost: TimerNotification[]; toDismiss: string[] } {
  const prevById = new Map(prev.map((n) => [n.identifier, n]));
  const nextIds = new Set(next.map((n) => n.identifier));
  const toPost = next.filter((n) => {
    const p = prevById.get(n.identifier);
    return !p || p.title !== n.title || p.body !== n.body;
  });
  const toDismiss = prev.filter((n) => !nextIds.has(n.identifier)).map((n) => n.identifier);
  return { toPost, toDismiss };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/notifications/content.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/notifications/content.ts src/notifications/content.test.ts
git commit -m "feat(notifications): pure content builder + reconcile diff for timer notifications"
```

---

### Task 2: Add expo-notifications dependency + config plugin

**Files:**
- Modify: `package.json` (via installer)
- Modify: `app.json` (plugins array)

**Interfaces:**
- Produces: the `expo-notifications` native module + a `timers` default channel wired via the config plugin. No JS exports.

- [ ] **Step 1: Install the SDK-56-pinned package**

Run: `npx expo install expo-notifications`
Expected: `expo-notifications` added to `package.json` dependencies at the SDK-56-compatible version (`~56.x`).

- [ ] **Step 2: Add the config plugin to `app.json`**

In `app.json`, add this entry to the `expo.plugins` array (after the existing `react-native-android-widget` block). `defaultChannel` makes immediate notifications land on our quiet channel:

```json
[
  "expo-notifications",
  {
    "defaultChannel": "timers"
  }
]
```

- [ ] **Step 3: Verify config resolves**

Run: `npx expo config --type public`
Expected: command succeeds and the printed config's `plugins`/`mods` include `expo-notifications` (and `android.permissions` includes `POST_NOTIFICATIONS`, added automatically by the module).

- [ ] **Step 4: Rebuild the dev client (required for any on-device testing from here on)**

Run: `npx expo run:android`
Expected: app builds and installs on the connected device/emulator with the new native module. (This is the dev build; subsequent JS-only tasks reload over Metro.)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json app.json
git commit -m "build(notifications): add expo-notifications dependency and timers channel plugin"
```

---

### Task 3: Post/dismiss modules + store subscriber (notifications appear & disappear)

**Files:**
- Create: `src/notifications/postNotification.ts` (stub)
- Create: `src/notifications/postNotification.android.ts` (real)
- Create: `src/notifications/register.ts` (stub)
- Create: `src/notifications/register.android.ts` (real — channel only in this task)
- Create: `src/notifications/sync.ts`
- Modify: `index.ts`
- Modify: `src/app/_layout.tsx:48-50`

**Interfaces:**
- Consumes: `desiredTimerNotifications`, `diffTimerNotifications`, `TimerNotification` (Task 1); `useAppStore` from `@/store/useAppStore` (has `.getState()` → `{ timers, children, selectedChildId }` and `.subscribe(fn)`).
- Produces:
  - `postNotification` module: `postTimerNotification(n: TimerNotification): Promise<void>`, `dismissTimerNotification(id: string): Promise<void>`
  - `sync` module: `initTimerNotificationSync(): void`

This task has no unit test (native surface / store glue); its deliverable is verified on-device. Steps still end with typecheck + lint gates.

- [ ] **Step 1: Create the no-op stub `src/notifications/postNotification.ts`**

```ts
// No notifications off Android — the platform-resolved `.android.ts` does the real work.
import type { TimerNotification } from '@/notifications/content';

export async function postTimerNotification(_n: TimerNotification): Promise<void> {}
export async function dismissTimerNotification(_id: string): Promise<void> {}
```

- [ ] **Step 2: Create the Android implementation `src/notifications/postNotification.android.ts`**

```ts
import * as Notifications from 'expo-notifications';

import type { TimerNotification } from '@/notifications/content';

/** Ask for POST_NOTIFICATIONS the first time we actually need to post (Android 13+).
 *  Denied → the feature silently no-ops; timers keep working. */
async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const req = await Notifications.requestPermissionsAsync();
  return req.granted;
}

export async function postTimerNotification(n: TimerNotification): Promise<void> {
  if (!(await ensurePermission())) return;
  await Notifications.scheduleNotificationAsync({
    identifier: n.identifier,
    content: { title: n.title, body: n.body, data: n.data, sticky: true },
    trigger: null, // immediate; lands on the `timers` default channel (see config plugin)
  });
}

export async function dismissTimerNotification(id: string): Promise<void> {
  await Notifications.dismissNotificationAsync(id);
}
```

- [ ] **Step 3: Create the register stub `src/notifications/register.ts`**

```ts
// No notification channel/listeners off Android.
export {};
```

- [ ] **Step 4: Create `src/notifications/register.android.ts` (channel only for now)**

```ts
import * as Notifications from 'expo-notifications';

// A LOW-importance channel: this is a persistent status, not an alert — no sound,
// vibration, or heads-up. `defaultChannel: "timers"` (config plugin) routes our
// immediate notifications here.
void Notifications.setNotificationChannelAsync('timers', {
  name: 'Running timers',
  importance: Notifications.AndroidImportance.LOW,
});
```

- [ ] **Step 5: Create the store subscriber `src/notifications/sync.ts`**

```ts
/**
 * Keeps the Android notification tray in sync with running timers — the exact
 * twin of `widgets/sync.ts`. On every store change, rebuild the desired
 * notification set from `state.timers`, diff it against what was last posted, and
 * post/dismiss the delta. No-ops cleanly off Android (the post module is a stub).
 */

import { desiredTimerNotifications, diffTimerNotifications, type TimerNotification } from '@/notifications/content';
import { dismissTimerNotification, postTimerNotification } from '@/notifications/postNotification';
import { useAppStore } from '@/store/useAppStore';

let prev: TimerNotification[] = [];
let started = false;

export function initTimerNotificationSync(): void {
  if (started) return;
  started = true;
  const run = async () => {
    const s = useAppStore.getState();
    const child = s.children.find((c) => c.id === s.selectedChildId);
    const next = desiredTimerNotifications(s.timers, child?.first ?? '');
    const { toPost, toDismiss } = diffTimerNotifications(prev, next);
    prev = next;
    for (const n of toPost) await postTimerNotification(n);
    for (const id of toDismiss) await dismissTimerNotification(id);
  };
  useAppStore.subscribe(run);
  void run();
}
```

- [ ] **Step 6: Register the Android side-effect module in `index.ts`**

Add the import directly below the existing widget register import:

```ts
// App entry. Boots expo-router, then (Android only, via the platform-resolved
// module) registers the home-screen widget's headless task handler.
import 'expo-router/entry';
import './src/widgets/register';
import './src/notifications/register';
```

- [ ] **Step 7: Start the subscriber in `src/app/_layout.tsx`**

Add the import beside the widget sync import (near line 20):

```ts
import { initTimerNotificationSync } from '@/notifications/sync';
```

Then extend the existing init effect (currently lines 48-50):

```tsx
  useEffect(() => {
    initWidgetSync();
    initTimerNotificationSync();
  }, []);
```

- [ ] **Step 8: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 9: Verify on-device (dev build from Task 2)**

With Metro running (`npx expo start`), reload the app, then:
1. Start a timer (feeding/pumping/tummy/sleep) in the app.
2. Expected: the first start prompts for notification permission; after granting, a **sticky** (non-swipeable) notification appears showing "<child> · <activity>" / "Started <time>", **silently** (no sound/heads-up — confirms the LOW `timers` channel).
3. Start a second timer → a second independent notification.
4. Stop/discard a timer in the app → its notification disappears; the other remains.
5. Edit a running timer's start time → its notification body updates.

- [ ] **Step 10: Commit**

```bash
git add src/notifications/postNotification.ts src/notifications/postNotification.android.ts \
        src/notifications/register.ts src/notifications/register.android.ts \
        src/notifications/sync.ts index.ts src/app/_layout.tsx
git commit -m "feat(notifications): sticky per-timer notifications synced from the store"
```

---

### Task 4: Tap-to-open the timers page

**Files:**
- Modify: `src/notifications/register.android.ts`

**Interfaces:**
- Consumes: `router` from `expo-router`; the `data.url` (`'/timers'`) set by `buildTimerNotification` (Task 1).
- Produces: no new exports — adds tap handling as a module side-effect.

On-device verified (native listener + navigation).

- [ ] **Step 1: Add the response listener + cold-start handling to `src/notifications/register.android.ts`**

Append below the channel setup:

```ts
import { router } from 'expo-router';

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
```

(Keep the `import { router } from 'expo-router';` at the top of the file with the other imports rather than inline — shown here for locality.)

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. (`data?.url` is `unknown`; the `=== '/timers'` comparison narrows it safely.)

- [ ] **Step 3: Verify on-device**

1. Start a timer, background the app, tap its notification → app comes to the foreground on the **timers** page.
2. Fully kill the app, tap a timer notification → app cold-starts and lands on the timers page.
3. With multiple timers, tapping any of their notifications → timers page.

- [ ] **Step 4: Commit**

```bash
git add src/notifications/register.android.ts
git commit -m "feat(notifications): tap a timer notification to open the timers page"
```

---

### Task 5: Widget/tray consistency for headless naps

**Files:**
- Modify: `src/widgets/napToggle.ts`
- Modify: `src/widgets/napToggle.test.ts`

**Interfaces:**
- Consumes: `buildTimerNotification` (Task 1); `postTimerNotification`, `dismissTimerNotification` (Task 3).
- Produces: no new exports — `toggleNapFromWidget` now also posts/dismisses the nap's notification.

The Nap widget starts/stops naps headlessly, bypassing the store subscriber, so it must touch the tray directly or a widget-stopped nap leaves a ghost notification. No timer→entry logic changes.

- [ ] **Step 1: Write the failing test additions**

In `src/widgets/napToggle.test.ts`, add a mock for the post module near the top (below the AsyncStorage mock), and import the mocked fns:

```ts
vi.mock('@/notifications/postNotification', () => ({
  postTimerNotification: vi.fn(async () => {}),
  dismissTimerNotification: vi.fn(async () => {}),
}));
```

Add to the imports at the top:

```ts
import { dismissTimerNotification, postTimerNotification } from '@/notifications/postNotification';
```

Add `vi.clearAllMocks();` inside the existing `beforeEach` (after `mem.store.clear();`).

Then add these assertions:

```ts
it('start: posts a sticky notification for the new nap', async () => {
  await writeWidgetSnapshot(snap({ childName: 'Ada' }));
  await toggleNapFromWidget(1000);
  expect(postTimerNotification).toHaveBeenCalledTimes(1);
  expect(vi.mocked(postTimerNotification).mock.calls[0][0]).toMatchObject({
    title: 'Ada · Sleep',
    data: { url: '/timers', timerId: 't1000' },
  });
});

it('stop: dismisses the nap notification by timer id', async () => {
  await writeWidgetSnapshot(snap({ sleepStart: 1000 }));
  await saveTimers([{ id: 't1', activity: 'sleep', name: 'Sleep', start: 1000, saveAs: 'sleep' }]);
  await toggleNapFromWidget(5000);
  expect(dismissTimerNotification).toHaveBeenCalledWith('t1');
});
```

Note: the started sleep timer's id is `'t' + now` (see `startSleepTimer`), so a `now` of `1000` yields id `t1000`.

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npm test -- src/widgets/napToggle.test.ts`
Expected: the two new cases FAIL (post/dismiss not called); existing cases still pass.

- [ ] **Step 3: Wire post/dismiss into `src/widgets/napToggle.ts`**

Add imports at the top:

```ts
import { buildTimerNotification } from '@/notifications/content';
import { dismissTimerNotification, postTimerNotification } from '@/notifications/postNotification';
```

In the **stop** branch, after `await saveTimers(timers.filter((t) => t !== running));` and before building `next`, dismiss the notification:

```ts
    await saveTimers(timers.filter((t) => t !== running));
    await dismissTimerNotification(running.id);
```

Replace the **start** branch so the created timer is captured and its notification posted:

```ts
  // Start: append a running sleep timer in place.
  const timer = startSleepTimer(now);
  await saveTimers([...timers, timer]);
  const next: WidgetSnapshot = { ...snap, sleepStart: now };
  await writeWidgetSnapshot(next);
  await postTimerNotification(buildTimerNotification(timer, snap.childName));
  return next;
```

- [ ] **Step 4: Run the tests to verify all pass**

Run: `npm test -- src/widgets/napToggle.test.ts`
Expected: PASS (existing + two new cases).

- [ ] **Step 5: Full test + typecheck + lint**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all green.

- [ ] **Step 6: Verify on-device**

1. From the home-screen Nap widget, start a nap → a sticky nap notification appears.
2. From the widget, stop the nap → the notification disappears (no ghost).

- [ ] **Step 7: Commit**

```bash
git add src/widgets/napToggle.ts src/widgets/napToggle.test.ts
git commit -m "feat(notifications): keep the tray honest for widget-driven naps"
```

---

## Self-Review

**Spec coverage** (against `2026-07-04-android-timer-notifications-design.md`):
- Sticky notification per running timer → Task 3 (post w/ `sticky:true`), Task 1 (`desired`/`diff`).
- Static "Started H:MM" content, child+activity title → Task 1 (`formatClock`, `buildTimerNotification`).
- Tap → `/timers` → Task 4.
- No buttons → nothing builds a category/action (absent by construction).
- Store-subscriber reconcile mirroring `initWidgetSync` → Task 3 (`sync.ts`).
- LOW-importance channel → Task 3 (register.android) + Task 2 (`defaultChannel`).
- `POST_NOTIFICATIONS` on first start; denial no-ops → Task 3 (`ensurePermission` inside `postTimerNotification`).
- Platform split via `.android` files → Tasks 3 & 4 (stubs + android impls).
- Cross-surface consistency (napToggle post/dismiss, no entry logic touched) → Task 5.
- Config plugin + dev build → Task 2.
- iOS/web no-op → stubs in Task 3 (`postNotification.ts`, `register.ts`).
- Out of scope (grouping, reboot restore, buttons, iOS Live Activities) → not implemented, by design.

**Placeholder scan:** none — every code step contains full code and exact commands.

**Type consistency:** `TimerNotification` shape and `postTimerNotification`/`dismissTimerNotification` signatures are identical across the stub, the android impl, `sync.ts`, and `napToggle.ts`. `data.url` is `'/timers'` everywhere it is produced (Task 1) and consumed (Task 4). Notification identifier is `timer.id` in `buildTimerNotification`, dismissed by `running.id` in Task 5 and by diff ids in Task 3.

**Known on-device checks (not unit-testable):** LOW channel silences the notification (Task 3 step 9.2); cold-start deep link fires after mount (Task 4 step 3.2); posting from the widget's headless task context (Task 5 step 6). If the headless post proves unreliable, it is harmless — the store subscriber reconciles on next app open.
