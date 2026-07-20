# Scheduled Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify a parent when their expected baby's due date arrives, and reuse the same mechanism for stale-timer, age-milestone, and pumping reminders.

**Architecture:** A pure module (`scheduled.ts`) maps store state to a desired set of scheduled notifications; a platform module reconciles that set against what Android actually holds via `getAllScheduledNotificationsAsync()`. All four reminders are entries in the desired set, so cancellation is a property of the diff rather than code anyone has to remember to write. This mirrors the existing `content.ts` / `sync.ts` split for immediate timer notifications.

**Tech Stack:** Expo SDK 56, expo-notifications, React Native 0.85, zustand v5, expo-router, vitest.

**Spec:** `docs/superpowers/specs/2026-07-20-scheduled-reminders-design.md`

## Global Constraints

- **Android only.** `applySchedule.ts` and `permission.ts` are no-op stubs; the real work lives in `.android.ts` twins. Follow the existing `postNotification.ts` / `postNotification.android.ts` pattern exactly.
- **Read the versioned Expo docs** at https://docs.expo.dev/versions/v56.0.0/ before writing any expo-notifications code. This is a project rule in `AGENTS.md`.
- **No em-dashes** in code comments, docs, commit messages, or UI copy. Use commas, colons, or separate sentences.
- **No exact alarms.** Do not add `SCHEDULE_EXACT_ALARM` or `USE_EXACT_ALARM` to `app.json`. `RECEIVE_BOOT_COMPLETED` is added automatically by expo-notifications. `app.json` needs no changes in this plan.
- **Never request notification permission from the reconciler.** It checks permission and silently skips. Requests happen only in `setup/baby.tsx` and the notifications settings screen.
- **Age milestone copy stays purely celebratory.** No mention of checkups, appointments, vaccinations, or development expectations. The cadence (1w, 1m, 3m, 6m, 9m, 1y) must not be changed to shadow a clinical schedule.
- **All reminder identifiers start with `budkin:`.** The reconciler ignores anything without that prefix so it can never cancel a timer notification it does not own.
- **Fixed reminder hour:** 09:00 local for due-date and age reminders. Not user-configurable.
- **Never return a new reference from a `useAppStore` selector.** No inline `.filter()` / `.map()` in a selector. Select raw state and derive during render, or web routes blank-screen with "Maximum update depth exceeded".
- Run `npm test` (vitest) after every task. Run `npx tsc --noEmit` before each commit.

---

### Task 1: Pure scheduled-notification layer, due-date reminders only

**Files:**
- Create: `src/notifications/scheduled.ts`
- Test: `src/notifications/scheduled.test.ts`

**Interfaces:**
- Consumes: `Child`, `Timer` from `@/types/models`.
- Produces: `REMINDER_PREFIX`, `REMINDER_HOUR`, `ReminderKind`, `ScheduledNotification`, `ReminderPrefs`, `ScheduleInput`, `ExistingNotification`, `atReminderHour(ms)`, `addDays(ms, n)`, `addMonths(ms, n)`, `desiredScheduled(input, now)`, `diffScheduled(existing, desired)`. Tasks 3, 5, 6, and 8 all build on these exact names.

- [ ] **Step 1: Write the failing test**

Create `src/notifications/scheduled.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  addDays,
  addMonths,
  atReminderHour,
  desiredScheduled,
  diffScheduled,
  REMINDER_PREFIX,
  type ReminderPrefs,
  type ScheduleInput,
} from '@/notifications/scheduled';
import type { Child } from '@/types/models';

/** Local-time construction, so the 09:00 assertions hold in any timezone. */
const at = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime();

const prefs = (over: Partial<ReminderPrefs> = {}): ReminderPrefs => ({
  dueDateReminders: true,
  staleTimerReminders: true,
  ageMilestones: true,
  pumpingReminders: false,
  pumpingIntervalMin: 180,
  pumpingEnabledAt: null,
  ...over,
});

const child = (over: Partial<Child> = {}): Child => ({
  id: 'c1',
  first: 'Rowan',
  last: '',
  birth: at(2026, 9, 1),
  color: '#208AEF',
  ...over,
});

const input = (over: Partial<ScheduleInput> = {}): ScheduleInput => ({
  children: [],
  timers: [],
  prefs: prefs(),
  lastPumpAt: null,
  ...over,
});

describe('atReminderHour', () => {
  it('moves any instant to 09:00 on its own calendar day', () => {
    expect(atReminderHour(at(2026, 9, 1, 23))).toBe(at(2026, 9, 1, 9));
    expect(atReminderHour(at(2026, 9, 1, 2))).toBe(at(2026, 9, 1, 9));
  });
});

describe('addDays / addMonths', () => {
  it('adds days by calendar, not by fixed milliseconds', () => {
    expect(addDays(at(2026, 9, 8), -7)).toBe(at(2026, 9, 1));
  });
  it('clamps a month addition to the last day of a short month', () => {
    // 31 January plus three months has no 31 April, so it lands on the 30th.
    expect(addMonths(at(2026, 1, 31), 3)).toBe(at(2026, 4, 30));
  });
  it('adds whole months when the day exists', () => {
    expect(addMonths(at(2026, 1, 15), 3)).toBe(at(2026, 4, 15));
  });
});

describe('desiredScheduled: due date', () => {
  const expecting = child({ expected: true, birth: at(2026, 9, 1) });

  it('schedules a lead-up seven days out and one on the day, both at 09:00', () => {
    const out = desiredScheduled(input({ children: [expecting] }), at(2026, 8, 1));
    expect(out.map((n) => n.fireAt)).toEqual([at(2026, 8, 25, 9), at(2026, 9, 1, 9)]);
    expect(out[0].title).toBe('Rowan is due next week');
    expect(out[1].title).toBe("Today is Rowan's due date");
    expect(out.every((n) => n.identifier.startsWith(REMINDER_PREFIX))).toBe(true);
    expect(out.every((n) => n.data.url === '/')).toBe(true);
  });

  it('encodes the fire time in the identifier so editing the due date reschedules', () => {
    const a = desiredScheduled(input({ children: [expecting] }), at(2026, 8, 1));
    const moved = child({ expected: true, birth: at(2026, 9, 8) });
    const b = desiredScheduled(input({ children: [moved] }), at(2026, 8, 1));
    expect(a[1].identifier).not.toBe(b[1].identifier);
  });

  it('skips the lead-up when the due date is entered inside seven days', () => {
    const out = desiredScheduled(input({ children: [expecting] }), at(2026, 8, 28));
    expect(out).toHaveLength(1);
    expect(out[0].fireAt).toBe(at(2026, 9, 1, 9));
  });

  it('schedules nothing once the due date has passed', () => {
    const out = desiredScheduled(input({ children: [expecting] }), at(2026, 9, 2));
    expect(out).toEqual([]);
  });

  it('drops due reminders once the birth is confirmed', () => {
    const born = child({ expected: false, birth: at(2026, 9, 1) });
    const out = desiredScheduled(input({ children: [born] }), at(2026, 8, 1));
    expect(out.filter((n) => n.kind === 'due')).toEqual([]);
  });

  it('drops due reminders when the pref is off', () => {
    const out = desiredScheduled(
      input({ children: [expecting], prefs: prefs({ dueDateReminders: false }) }),
      at(2026, 8, 1),
    );
    expect(out).toEqual([]);
  });

  it('covers every expecting child, not only the first', () => {
    const second = child({ id: 'c2', first: 'Wren', expected: true, birth: at(2026, 10, 1) });
    const out = desiredScheduled(input({ children: [expecting, second] }), at(2026, 8, 1));
    expect(out).toHaveLength(4);
  });
});

describe('diffScheduled', () => {
  const n = {
    identifier: `${REMINDER_PREFIX}due:c1:day:1`,
    kind: 'due' as const,
    title: 'Today is Rowan\'s due date',
    body: 'Tap when your baby arrives.',
    fireAt: 1,
    data: { url: '/' },
  };

  it('schedules what is desired but not yet pending', () => {
    expect(diffScheduled([], [n])).toEqual({ toSchedule: [n], toCancel: [] });
  });

  it('cancels what is pending but no longer desired', () => {
    const existing = [{ identifier: n.identifier, title: n.title, body: n.body }];
    expect(diffScheduled(existing, [])).toEqual({ toSchedule: [], toCancel: [n.identifier] });
  });

  it('does nothing when pending already matches', () => {
    const existing = [{ identifier: n.identifier, title: n.title, body: n.body }];
    expect(diffScheduled(existing, [n])).toEqual({ toSchedule: [], toCancel: [] });
  });

  it('reschedules when the title changed, e.g. the child was renamed', () => {
    const existing = [{ identifier: n.identifier, title: 'Today is Wren\'s due date', body: n.body }];
    expect(diffScheduled(existing, [n]).toSchedule).toEqual([n]);
  });

  it('never cancels an identifier it does not own', () => {
    const existing = [{ identifier: 'some-timer-uuid', title: 'Rowan · Sleep', body: 'Started 14:45' }];
    expect(diffScheduled(existing, [])).toEqual({ toSchedule: [], toCancel: [] });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/notifications/scheduled.test.ts`
Expected: FAIL, "Failed to resolve import ... /notifications/scheduled".

- [ ] **Step 3: Write the implementation**

Create `src/notifications/scheduled.ts`:

```ts
/**
 * Pure shaping + reconcile logic for SCHEDULED reminders (due date, stale
 * timers, age milestones, pumping). No native calls and no I/O, so it is
 * trivially unit-testable.
 *
 * The twin of `content.ts`, with one important difference. `content.ts` drives
 * IMMEDIATE notifications and `sync.ts` can diff against an in-memory `prev`,
 * because those are re-derived on every launch. These outlive the process: the
 * app can be killed for weeks while Android still holds a pending due-date
 * alert. So the reconcile reads the OS's pending set and diffs against THAT.
 */

import type { Child, Timer } from '@/types/models';

/** Every identifier we own starts with this. `diffScheduled` refuses to cancel
 *  anything without it, so a timer notification (bare uuid) is never touched. */
export const REMINDER_PREFIX = 'budkin:';

/** Local hour for due-date and age reminders. Fixed, not a user setting. */
export const REMINDER_HOUR = 9;

/** Days before the due date for the lead-up reminder. */
export const DUE_LEAD_DAYS = 7;

export type ReminderKind = 'due' | 'stale' | 'age' | 'pump';

export interface ScheduledNotification {
  /** stable, and encodes the fire time so a moved date yields a new id */
  identifier: string;
  kind: ReminderKind;
  title: string;
  body: string;
  /** epoch ms */
  fireAt: number;
  data: { url: string };
}

/** What the OS reports as pending. Only the fields the diff compares. */
export interface ExistingNotification {
  identifier: string;
  title: string;
  body: string;
}

export interface ReminderPrefs {
  dueDateReminders: boolean;
  staleTimerReminders: boolean;
  ageMilestones: boolean;
  pumpingReminders: boolean;
  pumpingIntervalMin: number;
  /** when the pumping toggle was last switched on, epoch ms */
  pumpingEnabledAt: number | null;
}

/** A narrow projection of the store, so this layer never imports store types. */
export interface ScheduleInput {
  children: Child[];
  timers: Timer[];
  prefs: ReminderPrefs;
  /** end (or start, when still running) of the most recent pumping entry */
  lastPumpAt: number | null;
}

/** 09:00 local on the calendar day containing `ms`. Built from local Y/M/D
 *  rather than by adding milliseconds, so DST cannot shift the hour. */
export function atReminderHour(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), REMINDER_HOUR, 0, 0, 0).getTime();
}

/** Calendar day arithmetic. A 23- or 25-hour DST day would break `n * 86400000`. */
export function addDays(ms: number, n: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), 0, 0).getTime();
}

/** Calendar month arithmetic, clamping to the last day of a short target month
 *  so a birth on the 31st still gets a 3-month milestone in April. */
export function addMonths(ms: number, n: number): number {
  const d = new Date(ms);
  const day = d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1, d.getHours(), d.getMinutes(), 0, 0);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target.getTime();
}

function dueReminders(child: Child, now: number): ScheduledNotification[] {
  // `birth` holds the DUE date while `expected` is true. See Child in models.ts.
  if (!child.expected) return [];
  const out: ScheduledNotification[] = [];
  const lead = atReminderHour(addDays(child.birth, -DUE_LEAD_DAYS));
  const day = atReminderHour(child.birth);
  if (lead > now) {
    out.push({
      identifier: `${REMINDER_PREFIX}due:${child.id}:lead:${lead}`,
      kind: 'due',
      title: `${child.first} is due next week`,
      body: 'Budkin is ready when they are.',
      fireAt: lead,
      data: { url: '/' },
    });
  }
  if (day > now) {
    out.push({
      identifier: `${REMINDER_PREFIX}due:${child.id}:day:${day}`,
      kind: 'due',
      title: `Today is ${child.first}'s due date`,
      body: 'Tap when your baby arrives.',
      fireAt: day,
      data: { url: '/' },
    });
  }
  return out;
}

export function desiredScheduled(input: ScheduleInput, now: number): ScheduledNotification[] {
  const out: ScheduledNotification[] = [];
  if (input.prefs.dueDateReminders) {
    for (const c of input.children) out.push(...dueReminders(c, now));
  }
  return out;
}

/**
 * Diff the desired set against what the OS already holds. A pending
 * notification is rescheduled when its title or body changed (a renamed child),
 * and cancelled when it left the desired set. Anything without our prefix is
 * invisible to both halves.
 */
export function diffScheduled(
  existing: ExistingNotification[],
  desired: ScheduledNotification[],
): { toSchedule: ScheduledNotification[]; toCancel: string[] } {
  const ours = existing.filter((e) => e.identifier.startsWith(REMINDER_PREFIX));
  const byId = new Map(ours.map((e) => [e.identifier, e]));
  const desiredIds = new Set(desired.map((d) => d.identifier));
  const toSchedule = desired.filter((d) => {
    const p = byId.get(d.identifier);
    return !p || p.title !== d.title || p.body !== d.body;
  });
  const toCancel = ours.filter((e) => !desiredIds.has(e.identifier)).map((e) => e.identifier);
  return { toSchedule, toCancel };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/notifications/scheduled.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/notifications/scheduled.ts src/notifications/scheduled.test.ts
git commit -m "feat(notifications): pure scheduled-reminder layer with due-date alerts"
```

---

### Task 2: Reminder preferences in prefs and the store

**Files:**
- Modify: `src/data/prefs.ts:17-23` (the `Prefs` interface)
- Modify: `src/store/useAppStore.ts` (state fields, defaults, setters, hydration)

**Interfaces:**
- Consumes: `savePrefs` / `loadPrefs` from `@/data/prefs`, `ReminderPrefs` from Task 1.
- Produces: store fields `dueDateReminders`, `staleTimerReminders`, `ageMilestones`, `pumpingReminders`, `pumpingIntervalMin`, `pumpingEnabledAt`, and setters `setReminderPref(key, value)` and `setPumpingInterval(minutes)`. Tasks 3, 7, and 8 read these.

Pumping defaults off because it applies to a subset of parents and needs an interval choice. The rest default on, which is safe only because the reconciler never prompts for permission by itself.

- [ ] **Step 1: Add the fields to the Prefs interface**

In `src/data/prefs.ts`, extend the interface (leave `loadPrefs` / `savePrefs` untouched, the merge already handles new fields):

```ts
export interface Prefs {
  themeMode: ThemeMode;
  /** Budkin-local metric/imperial display lens (default 'metric'). */
  unitSystem: UnitSystem;
  /** true once first-run setup has been completed. */
  tutorialSeen: boolean;
  /** Scheduled reminder toggles. See src/notifications/scheduled.ts. */
  dueDateReminders: boolean;
  staleTimerReminders: boolean;
  ageMilestones: boolean;
  pumpingReminders: boolean;
  pumpingIntervalMin: number;
  /** when the pumping toggle was last switched on, epoch ms */
  pumpingEnabledAt: number | null;
}
```

- [ ] **Step 2: Add the state fields and defaults to the store**

In `src/store/useAppStore.ts`, add to the state interface next to `unitSystem` (around line 107):

```ts
  dueDateReminders: boolean;
  staleTimerReminders: boolean;
  ageMilestones: boolean;
  pumpingReminders: boolean;
  pumpingIntervalMin: number;
  pumpingEnabledAt: number | null;
  setReminderPref: (
    key: 'dueDateReminders' | 'staleTimerReminders' | 'ageMilestones' | 'pumpingReminders',
    value: boolean,
  ) => void;
  setPumpingInterval: (minutes: number) => void;
```

And to the initial state next to `unitSystem: 'metric'` (around line 689):

```ts
  dueDateReminders: true,
  staleTimerReminders: true,
  ageMilestones: true,
  pumpingReminders: false,
  pumpingIntervalMin: 180,
  pumpingEnabledAt: null,
```

- [ ] **Step 3: Add the setters, following the setUnitSystem pattern**

Add next to `setUnitSystem` (around line 745):

The store's state interface is named `AppState` (declared at `src/store/useAppStore.ts:90`) and is file-local, so the `Pick` below resolves without an import.

```ts
  setReminderPref: (key, value) => {
    // Switching pumping ON stamps the anchor the reminder grid is built from,
    // so a parent who has never logged a pump still gets reminders. Switching
    // OFF clears it, so re-enabling later does not resume an ancient phase.
    if (key === 'pumpingReminders') {
      const pumpingEnabledAt = value ? Date.now() : null;
      set({ pumpingReminders: value, pumpingEnabledAt });
      void savePrefs({ pumpingReminders: value, pumpingEnabledAt });
      return;
    }
    set({ [key]: value } as Pick<AppState, typeof key>);
    void savePrefs({ [key]: value });
  },
  setPumpingInterval: (minutes) => {
    set({ pumpingIntervalMin: minutes });
    void savePrefs({ pumpingIntervalMin: minutes });
  },
```

- [ ] **Step 4: Hydrate the fields on launch**

Find where `loadPrefs` results are applied (around line 794, next to `if (prefs.unitSystem) set(...)`) and add:

```ts
    if (prefs.dueDateReminders != null) set({ dueDateReminders: prefs.dueDateReminders });
    if (prefs.staleTimerReminders != null) set({ staleTimerReminders: prefs.staleTimerReminders });
    if (prefs.ageMilestones != null) set({ ageMilestones: prefs.ageMilestones });
    if (prefs.pumpingReminders != null) set({ pumpingReminders: prefs.pumpingReminders });
    if (prefs.pumpingIntervalMin != null) set({ pumpingIntervalMin: prefs.pumpingIntervalMin });
    if (prefs.pumpingEnabledAt !== undefined) set({ pumpingEnabledAt: prefs.pumpingEnabledAt });
```

The `!= null` guard matters: a persisted `false` must survive hydration, which a truthiness check would drop. `pumpingEnabledAt` uses `!== undefined` because `null` is a meaningful stored value.

- [ ] **Step 5: Typecheck, test, and commit**

```bash
npx tsc --noEmit
npm test
git add src/data/prefs.ts src/store/useAppStore.ts
git commit -m "feat(notifications): persist reminder preferences"
```

---

### Task 3: Wire the reconciler to Android, due-date reminders go live

**Files:**
- Modify: `src/notifications/content.ts` (add `REMINDER_CHANNEL_ID`)
- Create: `src/notifications/applySchedule.ts` (stub)
- Create: `src/notifications/applySchedule.android.ts`
- Create: `src/notifications/permission.ts` (stub)
- Create: `src/notifications/permission.android.ts`
- Create: `src/notifications/scheduleSync.ts`
- Modify: `src/notifications/register.android.ts` (reminders channel, generalised tap routing)
- Modify: `src/app/_layout.tsx:24,55`

**Interfaces:**
- Consumes: `desiredScheduled`, `diffScheduled`, `ScheduledNotification`, `ExistingNotification`, `ReminderPrefs`, `ScheduleInput` from Task 1; the store fields from Task 2.
- Produces: `applyScheduled(desired)`, `requestReminderPermission()`, `hasReminderPermission()`, `initScheduledReminderSync()`. Tasks 4 and 7 call the permission helpers.

- [ ] **Step 1: Add the reminder channel id**

In `src/notifications/content.ts`, below `TIMER_CHANNEL_ID`:

```ts
/** Android channel id for SCHEDULED reminders (due date, stale timers, age
 *  milestones, pumping). Separate from TIMER_CHANNEL_ID on purpose: that one is
 *  LOW importance because a running timer is a persistent status, and reusing it
 *  would make every reminder here silent. It also lets a user mute reminders in
 *  Android settings without losing the timer display. */
export const REMINDER_CHANNEL_ID = 'reminders';
```

- [ ] **Step 2: Create the off-Android stubs**

Create `src/notifications/applySchedule.ts`:

```ts
// No scheduled reminders off Android, the platform-resolved `.android.ts` does
// the real work.
import type { ScheduledNotification } from '@/notifications/scheduled';

export async function applyScheduled(_desired: ScheduledNotification[]): Promise<void> {}
```

Create `src/notifications/permission.ts`:

```ts
// No notification permission model off Android.
export async function requestReminderPermission(): Promise<boolean> {
  return false;
}

export async function hasReminderPermission(): Promise<boolean> {
  return false;
}
```

- [ ] **Step 3: Create the Android permission module**

Create `src/notifications/permission.android.ts`:

```ts
import * as Notifications from 'expo-notifications';

/** Ask for POST_NOTIFICATIONS (Android 13+). Called ONLY from places with
 *  context for the ask: saving a due date, and the notification settings
 *  screen. The reconciler must never call this, a cold-launch permission
 *  dialog with no explanation is worse than the feature arriving a day later. */
export async function requestReminderPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const req = await Notifications.requestPermissionsAsync();
  return req.granted;
}

export async function hasReminderPermission(): Promise<boolean> {
  return (await Notifications.getPermissionsAsync()).granted;
}
```

- [ ] **Step 4: Create the Android apply module**

Create `src/notifications/applySchedule.android.ts`:

```ts
import * as Notifications from 'expo-notifications';

import { REMINDER_CHANNEL_ID } from '@/notifications/content';
import { hasReminderPermission } from '@/notifications/permission';
import { diffScheduled, type ExistingNotification, type ScheduledNotification } from '@/notifications/scheduled';

/** What Android currently holds, narrowed to the fields the diff compares. */
async function readScheduled(): Promise<ExistingNotification[]> {
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  return pending.map((r) => ({
    identifier: r.identifier,
    title: r.content.title ?? '',
    body: r.content.body ?? '',
  }));
}

/**
 * Reconcile the OS's pending set against the desired one. The OS is the source
 * of truth, NOT an in-memory `prev` like `sync.ts` keeps: these notifications
 * outlive the process, so a fresh `prev = []` on launch would schedule a second
 * copy of everything already pending.
 */
export async function applyScheduled(desired: ScheduledNotification[]): Promise<void> {
  // Silently skip while permission is missing. Everything else keeps working.
  if (!(await hasReminderPermission())) return;
  const { toSchedule, toCancel } = diffScheduled(await readScheduled(), desired);
  for (const id of toCancel) await Notifications.cancelScheduledNotificationAsync(id);
  for (const n of toSchedule) {
    // Cancel first. `toSchedule` includes ids that are ALREADY pending with
    // stale content (a renamed child), and expo-notifications does not document
    // what scheduling over a live identifier does. Cancelling makes it a
    // replace either way.
    await Notifications.cancelScheduledNotificationAsync(n.identifier);
    await Notifications.scheduleNotificationAsync({
      identifier: n.identifier,
      content: { title: n.title, body: n.body, data: n.data },
      // DATE trigger with an explicit channelId. Inexact by design: we do not
      // claim SCHEDULE_EXACT_ALARM, so Doze may delay delivery, which is fine
      // for every reminder here. See the spec's exact-alarm decision.
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: n.fireAt,
        channelId: REMINDER_CHANNEL_ID,
      },
    });
  }
}
```

- [ ] **Step 5: Create the store subscriber**

Create `src/notifications/scheduleSync.ts`:

```ts
/**
 * Keeps Android's pending reminder set in sync with the store, the scheduled
 * twin of `sync.ts`. On every relevant store change, rebuild the desired set and
 * hand it to the platform reconciler. No-ops cleanly off Android.
 */

import { applyScheduled } from '@/notifications/applySchedule';
import { desiredScheduled, type ScheduleInput } from '@/notifications/scheduled';
import { useAppStore } from '@/store/useAppStore';

let started = false;

type State = ReturnType<typeof useAppStore.getState>;

function toInput(s: State): ScheduleInput {
  let lastPumpAt: number | null = null;
  for (const e of s.entries) {
    if (e.type !== 'pumping') continue;
    const at = e.end ?? e.start;
    if (lastPumpAt === null || at > lastPumpAt) lastPumpAt = at;
  }
  return {
    children: s.children,
    timers: s.timers,
    prefs: {
      dueDateReminders: s.dueDateReminders,
      staleTimerReminders: s.staleTimerReminders,
      ageMilestones: s.ageMilestones,
      pumpingReminders: s.pumpingReminders,
      pumpingIntervalMin: s.pumpingIntervalMin,
      pumpingEnabledAt: s.pumpingEnabledAt,
    },
    lastPumpAt,
  };
}

export function initScheduledReminderSync(): void {
  if (started) return;
  started = true;
  const run = (s: State) => void applyScheduled(desiredScheduled(toInput(s), Date.now()));
  // Gate on the slices the desired set derives from. The per-second `now` tick
  // changes nothing here: fire times are absolute, so a launch-time run plus
  // state-change runs is sufficient and a tick-driven rebuild would be pure
  // churn.
  useAppStore.subscribe((state, previous) => {
    if (
      state.children === previous.children &&
      state.timers === previous.timers &&
      state.entries === previous.entries &&
      state.dueDateReminders === previous.dueDateReminders &&
      state.staleTimerReminders === previous.staleTimerReminders &&
      state.ageMilestones === previous.ageMilestones &&
      state.pumpingReminders === previous.pumpingReminders &&
      state.pumpingIntervalMin === previous.pumpingIntervalMin &&
      state.pumpingEnabledAt === previous.pumpingEnabledAt
    ) {
      return;
    }
    run(state);
  });
  run(useAppStore.getState());
}
```

- [ ] **Step 6: Register the channel and generalise tap routing**

In `src/notifications/register.android.ts`, import `REMINDER_CHANNEL_ID` alongside `TIMER_CHANNEL_ID`, then add below the existing `setNotificationChannelAsync` call:

```ts
// DEFAULT importance, unlike the LOW timers channel: these are alerts a parent
// should actually notice, not a persistent status.
void Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
  name: 'Reminders',
  importance: Notifications.AndroidImportance.DEFAULT,
});
```

Then replace `openFromResponse` so it routes any app-generated url rather than only `/timers`:

```ts
// Every notification we post carries its own destination in `data.url`, always
// app-generated: '/timers' for timers and stale-timer alerts, '/' for due
// dates, '/history' for age milestones.
function openFromResponse(response: Notifications.NotificationResponse | null): void {
  const url = response?.notification.request.content.data?.url;
  if (typeof url === 'string' && url.startsWith('/')) router.navigate(url as never);
}
```

- [ ] **Step 7: Start the sync on launch**

In `src/app/_layout.tsx`, add the import next to the existing one on line 24:

```ts
import { initScheduledReminderSync } from '@/notifications/scheduleSync';
```

and call it next to `initTimerNotificationSync()` on line 55:

```ts
    initTimerNotificationSync();
    initScheduledReminderSync();
```

- [ ] **Step 8: Typecheck, test, and commit**

```bash
npx tsc --noEmit
npm test
git add src/notifications/ src/app/_layout.tsx
git commit -m "feat(notifications): reconcile scheduled reminders against the OS"
```

Expected: all existing tests still pass. `sync.test.ts` must be unaffected, since nothing in the immediate-notification path changed.

---

### Task 4: Request permission when a due date is saved

**Files:**
- Modify: `src/app/setup/baby.tsx:61,71` (the two save paths)

**Interfaces:**
- Consumes: `requestReminderPermission` from Task 3.

This is the one place a permission prompt has natural context: the parent has just told the app when their baby is due, so asking to notify them about it needs no explanation.

- [ ] **Step 1: Import the helper**

In `src/app/setup/baby.tsx`, add:

```ts
import { requestReminderPermission } from '@/notifications/permission';
```

- [ ] **Step 2: Request after saving an expecting child**

Find the save path that creates the child with `expected: true` (around line 71) and request permission immediately after the child is saved. The request is fire-and-forget: the reconciler already runs on the store change, and it re-runs when permission is granted because granting does not itself change the store.

```ts
      // Ask here, where the parent has just entered a due date and the reason
      // for the ask is self-evident. Await it so the reconciler's next run sees
      // the granted permission; a rejected prompt just leaves reminders off.
      await requestReminderPermission();
```

Place this after the `saveChild(...)` call and before any navigation, and make the enclosing handler `async` if it is not already.

- [ ] **Step 3: Verify manually**

Run the app on Android, complete setup choosing "not yet" and entering a due date. Expected: the system notification permission dialog appears immediately after saving.

```bash
npx expo run:android
```

- [ ] **Step 4: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/app/setup/baby.tsx
git commit -m "feat(notifications): ask for permission when a due date is saved"
```

---

### Task 5: Stale timer reminders

**Files:**
- Modify: `src/notifications/scheduled.ts`
- Modify: `src/notifications/scheduled.test.ts`

**Interfaces:**
- Consumes: `ACTIVITY_LABEL` from `@/lib/activities`, `ActivityType` and `Timer` from `@/types/models`.
- Produces: `STALE_AFTER_MIN` (exported for the tests).

Only four activities are interval-shaped and therefore timer-capable: `feeding`, `sleep`, `pumping`, `tummy`. Sleep needs the widest margin because a night sleep entry legitimately runs twelve hours, and a false alarm at 3am is far worse than a late catch.

- [ ] **Step 1: Write the failing tests**

Append to `src/notifications/scheduled.test.ts` (and add `Timer` to the `@/types/models` import, `STALE_AFTER_MIN` to the `@/notifications/scheduled` import):

```ts
const timer = (over: Partial<Timer> = {}): Timer => ({
  id: 't1',
  childId: 'c1',
  activity: 'sleep',
  name: 'Sleep',
  start: at(2026, 9, 1, 20),
  saveAs: 'sleep',
  ...over,
});

describe('desiredScheduled: stale timers', () => {
  const born = child({ birth: at(2020, 1, 1) });

  it('schedules one alert per running timer at start plus its threshold', () => {
    const out = desiredScheduled(
      input({ children: [born], timers: [timer()], prefs: prefs({ ageMilestones: false }) }),
      at(2026, 9, 1, 21),
    );
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('stale');
    // Non-null assertion: the Record is typed `number | null` because point
    // activities have no threshold, but sleep always has one.
    expect(out[0].fireAt).toBe(at(2026, 9, 1, 20) + STALE_AFTER_MIN.sleep! * 60_000);
    expect(out[0].title).toBe('Rowan · Sleep');
    expect(out[0].body).toBe('Running for 14 hours. Still going?');
    expect(out[0].data.url).toBe('/timers');
  });

  it('uses the per-activity threshold', () => {
    expect(STALE_AFTER_MIN.tummy).toBe(45);
    expect(STALE_AFTER_MIN.pumping).toBe(120);
    expect(STALE_AFTER_MIN.feeding).toBe(180);
    expect(STALE_AFTER_MIN.sleep).toBe(840);
  });

  it('phrases sub-hour thresholds in minutes', () => {
    const out = desiredScheduled(
      input({
        children: [born],
        timers: [timer({ saveAs: 'tummy', activity: 'tummy' })],
        prefs: prefs({ ageMilestones: false }),
      }),
      at(2026, 9, 1, 20),
    );
    expect(out[0].body).toBe('Running for 45 minutes. Still going?');
  });

  it('encodes the fire time, so editing a running timer\'s start reschedules', () => {
    const a = desiredScheduled(
      input({ children: [born], timers: [timer()], prefs: prefs({ ageMilestones: false }) }),
      at(2026, 9, 1, 21),
    );
    const b = desiredScheduled(
      input({
        children: [born],
        timers: [timer({ start: at(2026, 9, 1, 21) })],
        prefs: prefs({ ageMilestones: false }),
      }),
      at(2026, 9, 1, 21),
    );
    // Title and body are identical, so only the identifier can carry the change.
    expect(a[0].title).toBe(b[0].title);
    expect(a[0].body).toBe(b[0].body);
    expect(a[0].identifier).not.toBe(b[0].identifier);
  });

  it('does not schedule a timer already past its threshold', () => {
    const out = desiredScheduled(
      input({ children: [born], timers: [timer()], prefs: prefs({ ageMilestones: false }) }),
      at(2026, 9, 2, 12),
    );
    expect(out).toEqual([]);
  });

  it('omits a point activity that cannot run a timer', () => {
    const out = desiredScheduled(
      input({
        children: [born],
        timers: [timer({ saveAs: 'diaper', activity: 'diaper' })],
        prefs: prefs({ ageMilestones: false }),
      }),
      at(2026, 9, 1, 20),
    );
    expect(out).toEqual([]);
  });

  it('falls back to the bare label when the timer has no matching child', () => {
    const out = desiredScheduled(
      input({ children: [], timers: [timer({ childId: 'gone' })], prefs: prefs({ ageMilestones: false }) }),
      at(2026, 9, 1, 21),
    );
    expect(out[0].title).toBe('Sleep');
  });

  it('drops stale alerts when the pref is off', () => {
    const out = desiredScheduled(
      input({
        children: [born],
        timers: [timer()],
        prefs: prefs({ staleTimerReminders: false, ageMilestones: false }),
      }),
      at(2026, 9, 1, 21),
    );
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/notifications/scheduled.test.ts`
Expected: FAIL, `STALE_AFTER_MIN` is not exported.

- [ ] **Step 3: Implement**

In `src/notifications/scheduled.ts`, add the import:

```ts
import { ACTIVITY_LABEL } from '@/lib/activities';
import type { ActivityType, Child, Timer } from '@/types/models';
```

Then add above `desiredScheduled`:

```ts
/**
 * How long a running timer may go before we suspect it was forgotten. Only the
 * four interval-shaped activities can run a timer; the rest are `null`.
 *
 * Sleep is deliberately the widest: a night sleep entry legitimately runs
 * twelve hours, and a false alarm at 3am is far worse than a late catch.
 */
export const STALE_AFTER_MIN: Record<ActivityType, number | null> = {
  tummy: 45,
  pumping: 120,
  feeding: 180,
  sleep: 840,
  diaper: null,
  bath: null,
  temperature: null,
  note: null,
  milestone: null,
};

/** "45 minutes", "3 hours". Every STALE_AFTER_MIN value is a whole number of
 *  hours or under an hour, so no mixed "1 hour 30" case can arise. */
function spanLabel(min: number): string {
  if (min < 60) return `${min} minutes`;
  const h = min / 60;
  return h === 1 ? '1 hour' : `${h} hours`;
}

function staleReminders(timer: Timer, children: Child[], now: number): ScheduledNotification[] {
  const threshold = STALE_AFTER_MIN[timer.saveAs];
  if (threshold == null) return [];
  const fireAt = timer.start + threshold * 60_000;
  // Already past: if the app was closed, the OS fired the alert scheduled when
  // the timer started. Nothing to do.
  if (fireAt <= now) return [];
  const label = ACTIVITY_LABEL[timer.saveAs];
  const child = children.find((c) => c.id === timer.childId);
  return [
    {
      // The fire time is in the identifier because editing a running timer's
      // start moves the alert without changing the title or body, and the diff
      // compares only those two.
      identifier: `${REMINDER_PREFIX}stale:${timer.id}:${fireAt}`,
      kind: 'stale',
      title: child?.first ? `${child.first} · ${label}` : label,
      body: `Running for ${spanLabel(threshold)}. Still going?`,
      fireAt,
      data: { url: '/timers' },
    },
  ];
}
```

Then extend `desiredScheduled`:

```ts
export function desiredScheduled(input: ScheduleInput, now: number): ScheduledNotification[] {
  const out: ScheduledNotification[] = [];
  if (input.prefs.dueDateReminders) {
    for (const c of input.children) out.push(...dueReminders(c, now));
  }
  if (input.prefs.staleTimerReminders) {
    for (const t of input.timers) out.push(...staleReminders(t, input.children, now));
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/notifications/scheduled.test.ts`
Expected: PASS, 24 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/notifications/scheduled.ts src/notifications/scheduled.test.ts
git commit -m "feat(notifications): warn about a timer left running"
```

---

### Task 6: Age milestone reminders

**Files:**
- Modify: `src/notifications/scheduled.ts`
- Modify: `src/notifications/scheduled.test.ts`

**Interfaces:**
- Produces: `AGE_STEPS`, `AGE_HORIZON_MONTHS` (exported for the tests).

Cadence is 1 week, 1 month, 3 months, 6 months, 9 months, 1 year, then yearly birthdays. Only occurrences inside a rolling twelve-month horizon are scheduled, and each launch extends it.

**Copy constraint (from the spec, non-negotiable):** purely celebratory. No mention of checkups, appointments, vaccinations, or development expectations. Do not "improve" the cadence toward 1/2/4/6/9/12 months, which is the vaccination schedule and would invite a parent to read these as medical reminders.

- [ ] **Step 1: Write the failing tests**

Append to `src/notifications/scheduled.test.ts` (add `AGE_STEPS` and `AGE_HORIZON_MONTHS` to the imports):

```ts
describe('desiredScheduled: age milestones', () => {
  const noOthers = prefs({ dueDateReminders: false, staleTimerReminders: false });

  it('uses the 1w / 1m / 3m / 6m / 9m cadence and nothing clinical', () => {
    expect(AGE_STEPS.map((s) => s.slug)).toEqual(['1w', '1m', '3m', '6m', '9m']);
  });

  it('schedules every upcoming step at 09:00', () => {
    const born = child({ birth: at(2026, 9, 1) });
    const out = desiredScheduled(input({ children: [born], prefs: noOthers }), at(2026, 9, 1, 12));
    expect(out.map((n) => n.fireAt)).toEqual([
      at(2026, 9, 8, 9),
      at(2026, 10, 1, 9),
      at(2026, 12, 1, 9),
      at(2027, 3, 1, 9),
      at(2027, 6, 1, 9),
      at(2027, 9, 1, 9),
    ]);
    expect(out[0].title).toBe('Rowan is one week old today.');
    expect(out[2].title).toBe('Rowan is three months old today.');
    expect(out[5].title).toBe('Happy first birthday, Rowan.');
    expect(out.every((n) => n.data.url === '/history')).toBe(true);
  });

  it('clamps a month step to the last day of a short month', () => {
    const born = child({ birth: at(2026, 1, 31) });
    const out = desiredScheduled(input({ children: [born], prefs: noOthers }), at(2026, 1, 31, 12));
    // 31 January plus three months has no 31 April.
    expect(out.find((n) => n.identifier.includes(':3m:'))?.fireAt).toBe(at(2026, 4, 30, 9));
  });

  it('drops steps that have already passed', () => {
    const born = child({ birth: at(2026, 1, 1) });
    const out = desiredScheduled(input({ children: [born], prefs: noOthers }), at(2026, 5, 1));
    expect(out.map((n) => n.identifier.split(':')[3])).toEqual(['6m', '9m', '1y']);
  });

  it('schedules only inside the rolling horizon', () => {
    expect(AGE_HORIZON_MONTHS).toBe(12);
    const born = child({ birth: at(2026, 9, 1) });
    const out = desiredScheduled(input({ children: [born], prefs: noOthers }), at(2026, 9, 1, 12));
    const horizon = addMonths(at(2026, 9, 1, 12), AGE_HORIZON_MONTHS);
    expect(out.every((n) => n.fireAt <= horizon)).toBe(true);
  });

  it('keeps going with yearly birthdays past the first', () => {
    const born = child({ birth: at(2024, 9, 1) });
    const out = desiredScheduled(input({ children: [born], prefs: noOthers }), at(2026, 1, 1));
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('Happy 2nd birthday, Rowan.');
    expect(out[0].fireAt).toBe(at(2026, 9, 1, 9));
  });

  it('ordinalises third and later birthdays correctly', () => {
    const born = child({ birth: at(2023, 9, 1) });
    const out = desiredScheduled(input({ children: [born], prefs: noOthers }), at(2026, 1, 1));
    expect(out[0].title).toBe('Happy 3rd birthday, Rowan.');
  });

  it('excludes an expecting child, whose birth field holds a due date', () => {
    const expecting = child({ expected: true, birth: at(2026, 9, 1) });
    const out = desiredScheduled(input({ children: [expecting], prefs: noOthers }), at(2026, 8, 1));
    expect(out).toEqual([]);
  });

  it('drops age milestones when the pref is off', () => {
    const born = child({ birth: at(2026, 9, 1) });
    const out = desiredScheduled(
      input({ children: [born], prefs: prefs({ dueDateReminders: false, staleTimerReminders: false, ageMilestones: false }) }),
      at(2026, 9, 1, 12),
    );
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/notifications/scheduled.test.ts`
Expected: FAIL, `AGE_STEPS` is not exported.

- [ ] **Step 3: Implement**

In `src/notifications/scheduled.ts`, add above `desiredScheduled`:

```ts
/**
 * Age milestones worth a notification, and their copy.
 *
 * Quarterly after the first month, so the parent gets a pattern they can
 * anticipate. The obvious alternative spine, roughly 1 / 2 / 4 / 6 / 9 / 12
 * months, is rejected on purpose: those are the well-baby visit and vaccination
 * dates, and a notification landing on them invites a parent to read it as a
 * reminder about an appointment. That is a medical implication the app has not
 * earned. Keep this cadence, and keep the copy celebratory.
 */
export const AGE_STEPS: { slug: string; days?: number; months?: number; label: string }[] = [
  { slug: '1w', days: 7, label: 'one week' },
  { slug: '1m', months: 1, label: 'one month' },
  { slug: '3m', months: 3, label: 'three months' },
  { slug: '6m', months: 6, label: 'six months' },
  { slug: '9m', months: 9, label: 'nine months' },
];

/** Only occurrences this far ahead are scheduled. Each launch extends it. */
export const AGE_HORIZON_MONTHS = 12;

/** Highest birthday we will ever schedule, a loop bound rather than a policy. */
const MAX_BIRTHDAY_YEAR = 25;

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function ageReminders(child: Child, now: number): ScheduledNotification[] {
  // `birth` holds a DUE date while expecting, so there is no age to celebrate.
  if (child.expected) return [];
  const horizon = addMonths(now, AGE_HORIZON_MONTHS);
  const out: ScheduledNotification[] = [];

  const push = (slug: string, fireAt: number, title: string) => {
    if (fireAt <= now || fireAt > horizon) return;
    out.push({
      identifier: `${REMINDER_PREFIX}age:${child.id}:${slug}:${fireAt}`,
      kind: 'age',
      title,
      body: 'Tap to look back.',
      fireAt,
      data: { url: '/history' },
    });
  };

  for (const step of AGE_STEPS) {
    const on =
      step.days != null ? addDays(child.birth, step.days) : addMonths(child.birth, step.months ?? 0);
    push(step.slug, atReminderHour(on), `${child.first} is ${step.label} old today.`);
  }

  for (let y = 1; y <= MAX_BIRTHDAY_YEAR; y++) {
    const fireAt = atReminderHour(addMonths(child.birth, y * 12));
    if (fireAt > horizon) break;
    const title =
      y === 1
        ? `Happy first birthday, ${child.first}.`
        : `Happy ${ordinal(y)} birthday, ${child.first}.`;
    push(`${y}y`, fireAt, title);
  }

  return out;
}
```

Then extend `desiredScheduled`:

```ts
  if (input.prefs.ageMilestones) {
    for (const c of input.children) out.push(...ageReminders(c, now));
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/notifications/scheduled.test.ts`
Expected: PASS, 33 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/notifications/scheduled.ts src/notifications/scheduled.test.ts
git commit -m "feat(notifications): celebrate age milestones and birthdays"
```

---

### Task 7: Notification settings screen

**Files:**
- Create: `src/components/Toggle.tsx` (extracted from `settings.tsx:16-42`)
- Move: `src/app/settings.tsx` to `src/app/settings/index.tsx`
- Modify: `src/app/settings/index.tsx` (use the shared Toggle, add a Notifications row)
- Create: `src/app/settings/notifications.tsx`

**Interfaces:**
- Consumes: store fields and setters from Task 2; `requestReminderPermission` / `hasReminderPermission` from Task 3.

`settings.tsx` becomes `settings/index.tsx`, so the `/settings` route is unchanged and nothing that links to it breaks. The pumping interval control lands here in Task 8; this task ships the three boolean toggles and the permission prompt.

- [ ] **Step 1: Extract the Toggle component**

Create `src/components/Toggle.tsx` with the body currently at `src/app/settings.tsx:16-42`:

```tsx
import { View } from 'react-native';

import { useTheme } from '@/theme/useTheme';

export function Toggle({ on }: { on: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        width: 50,
        height: 30,
        borderRadius: 99,
        backgroundColor: on ? t.primary : t.elevated,
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          position: 'absolute',
          top: 3,
          left: on ? 23 : 3,
          width: 24,
          height: 24,
          borderRadius: 99,
          backgroundColor: '#fff',
          boxShadow: '0px 1px 3px rgba(0,0,0,0.3)',
        }}
      />
    </View>
  );
}
```

- [ ] **Step 2: Move the settings screen and use the shared Toggle**

```bash
mkdir -p src/app/settings
git mv src/app/settings.tsx src/app/settings/index.tsx
```

In `src/app/settings/index.tsx`, delete the local `Toggle` function (lines 16-42) and import the shared one:

```ts
import { Toggle } from '@/components/Toggle';
```

- [ ] **Step 3: Add the Notifications row**

In `src/app/settings/index.tsx`, add a row that navigates to the sub-screen. Place it in its own group after the Appearance group, matching the existing `group` / `row` / `sectionLabel` styles already defined in the component:

```tsx
      <Txt weight={700} size={12.5} color={t.faint} tracking={0.8} style={{ ...sectionLabel, textTransform: 'uppercase' }}>
        Reminders
      </Txt>
      <View style={group}>
        <Pressable
          onPress={() => router.navigate('/settings/notifications')}
          accessibilityRole="button"
          accessibilityLabel="Notifications"
          style={(s) => [row, { cursor: 'pointer' }, isHovered(s) && { backgroundColor: t.elevated }]}
        >
          <Txt style={{ flex: 1 }}>Notifications</Txt>
          <Icon name="chevron-right" color={t.faint} size={20} />
        </Pressable>
      </View>
```

`chevron-right` is a valid `Icon` name (`src/components/Icon.tsx:33`).

- [ ] **Step 4: Build the notifications screen**

Create `src/app/settings/notifications.tsx`:

```tsx
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Toggle } from '@/components/Toggle';
import { Txt } from '@/components/Txt';
import { hasReminderPermission, requestReminderPermission } from '@/notifications/permission';
import { DesktopPage } from '@/shell/DesktopPage';
import { useDesktopShell } from '@/shell/useDesktopShell';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

export default function NotificationSettings() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const desktop = useDesktopShell();
  const dueDateReminders = useAppStore((s) => s.dueDateReminders);
  const staleTimerReminders = useAppStore((s) => s.staleTimerReminders);
  const ageMilestones = useAppStore((s) => s.ageMilestones);
  const setReminderPref = useAppStore((s) => s.setReminderPref);

  const [granted, setGranted] = useState(true);
  useEffect(() => {
    void hasReminderPermission().then(setGranted);
  }, []);

  const group = {
    backgroundColor: t.surface,
    borderWidth: 1.5,
    borderColor: t.line,
    borderRadius: 18,
    overflow: 'hidden' as const,
  };
  const row = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 15,
    paddingHorizontal: 16,
  };

  const rows: { key: 'dueDateReminders' | 'staleTimerReminders' | 'ageMilestones'; label: string; hint: string; on: boolean }[] = [
    {
      key: 'dueDateReminders',
      label: 'Due date',
      hint: 'A week before, and on the day itself.',
      on: dueDateReminders,
    },
    {
      key: 'staleTimerReminders',
      label: 'Timer left running',
      hint: 'If a timer runs far longer than usual.',
      on: staleTimerReminders,
    },
    {
      key: 'ageMilestones',
      label: 'Age milestones',
      hint: 'One week, one month, then every few months.',
      on: ageMilestones,
    },
  ];

  const body = (
    <>
      {!granted && (
        <Pressable
          onPress={() => void requestReminderPermission().then(setGranted)}
          accessibilityRole="button"
          accessibilityLabel="Allow notifications"
          style={(s) => [
            { ...group, ...row, marginTop: 4, cursor: 'pointer' },
            isHovered(s) && { backgroundColor: t.elevated },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Txt weight={600}>Allow notifications</Txt>
            <Txt size={13} color={t.faint} style={{ marginTop: 2 }}>
              Budkin cannot remind you until you turn these on.
            </Txt>
          </View>
          <Icon name="chevron-right" color={t.faint} size={20} />
        </Pressable>
      )}

      <View style={{ ...group, marginTop: 16 }}>
        {rows.map((r, i) => (
          <Pressable
            key={r.key}
            onPress={() => setReminderPref(r.key, !r.on)}
            accessibilityRole="switch"
            accessibilityLabel={r.label}
            accessibilityState={{ checked: r.on }}
            style={(s) => [
              row,
              i < rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: t.line },
              { cursor: 'pointer' },
              isHovered(s) && { backgroundColor: t.elevated },
            ]}
          >
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Txt>{r.label}</Txt>
              <Txt size={13} color={t.faint} style={{ marginTop: 2 }}>
                {r.hint}
              </Txt>
            </View>
            <Toggle on={r.on} />
          </Pressable>
        ))}
      </View>
    </>
  );

  // Mirrors settings/index.tsx:273-281 exactly. DesktopPage takes only
  // `maxWidth` and `children`, it has no title prop, so the heading lives in
  // the mobile branch just as it does there.
  if (desktop) return <DesktopPage maxWidth={560}>{body}</DesktopPage>;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: insets.bottom + 24 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4, marginBottom: 14 }}>
        <IconButton name="chevron-left" color={t.text} onPress={() => router.back()} accessibilityLabel="Back" />
        <Txt weight={700} size={22}>
          Notifications
        </Txt>
      </View>
      {body}
    </ScrollView>
  );
}
```

Verified signatures, no guessing needed: `DesktopPage({ maxWidth = 760, children })` at `src/shell/DesktopPage.tsx:12`, and `IconButton({ name, accessibilityLabel, onPress, color, size, style })` at `src/components/IconButton.tsx:18`.

- [ ] **Step 5: Verify on web**

```bash
CI=1 npx expo start --web
```

Navigate to `/settings`, tap Notifications, and toggle each switch. Expected: the route renders, toggles flip and persist across a reload. No "Maximum update depth exceeded" in the console, which would mean a selector returned a new reference.

- [ ] **Step 6: Typecheck, test, and commit**

```bash
npx tsc --noEmit
npm test
git add src/components/Toggle.tsx src/app/settings/
git commit -m "feat(notifications): add a notifications settings screen"
```

---

### Task 8: Pumping reminders

**Files:**
- Modify: `src/notifications/scheduled.ts`
- Modify: `src/notifications/scheduled.test.ts`
- Modify: `src/app/settings/notifications.tsx` (toggle plus interval chips)

**Interfaces:**
- Consumes: `setPumpingInterval` from Task 2, `Chip` from `@/components/Chip`.
- Produces: `PUMP_AHEAD` (exported for the tests).

Anchored to the last pumping entry rather than a fixed clock, so logging a pump pushes the next reminder out. A repeating reminder built from one-shot triggers needs the app to reschedule after each fire, so it schedules several ahead: that keeps the chain alive through roughly a day of the app never being opened.

- [ ] **Step 1: Write the failing tests**

Append to `src/notifications/scheduled.test.ts` (add `PUMP_AHEAD` to the imports):

```ts
describe('desiredScheduled: pumping', () => {
  const only = (over: Partial<ReminderPrefs>) =>
    prefs({ dueDateReminders: false, staleTimerReminders: false, ageMilestones: false, ...over });

  it('schedules a run of occurrences on the interval grid from the last pump', () => {
    const out = desiredScheduled(
      input({
        prefs: only({ pumpingReminders: true, pumpingIntervalMin: 180, pumpingEnabledAt: at(2026, 9, 1, 0) }),
        lastPumpAt: at(2026, 9, 1, 6),
      }),
      at(2026, 9, 1, 7),
    );
    expect(out).toHaveLength(PUMP_AHEAD);
    expect(out[0].fireAt).toBe(at(2026, 9, 1, 9));
    expect(out[1].fireAt).toBe(at(2026, 9, 1, 12));
    expect(out[0].title).toBe('Time to pump');
    expect(out[0].body).toBe('Tap to log a session.');
    expect(out[0].data.url).toBe('/timers');
  });

  it('re-anchors when a newer pump is logged', () => {
    const a = desiredScheduled(
      input({
        prefs: only({ pumpingReminders: true, pumpingIntervalMin: 180, pumpingEnabledAt: at(2026, 9, 1, 0) }),
        lastPumpAt: at(2026, 9, 1, 6),
      }),
      at(2026, 9, 1, 7),
    );
    const b = desiredScheduled(
      input({
        prefs: only({ pumpingReminders: true, pumpingIntervalMin: 180, pumpingEnabledAt: at(2026, 9, 1, 0) }),
        lastPumpAt: at(2026, 9, 1, 7),
      }),
      at(2026, 9, 1, 7),
    );
    expect(b[0].fireAt).toBe(at(2026, 9, 1, 10));
    expect(a[0].identifier).not.toBe(b[0].identifier);
  });

  it('falls back to the enable time when nothing has been pumped yet', () => {
    const out = desiredScheduled(
      input({
        prefs: only({ pumpingReminders: true, pumpingIntervalMin: 180, pumpingEnabledAt: at(2026, 9, 1, 6) }),
        lastPumpAt: null,
      }),
      at(2026, 9, 1, 7),
    );
    expect(out[0].fireAt).toBe(at(2026, 9, 1, 9));
  });

  it('re-enters the grid on phase when every occurrence has already passed', () => {
    // Enabled two days ago, app never opened since. Naively scheduling from the
    // anchor would produce only past instants and therefore nothing at all.
    const out = desiredScheduled(
      input({
        prefs: only({ pumpingReminders: true, pumpingIntervalMin: 180, pumpingEnabledAt: at(2026, 9, 1, 6) }),
        lastPumpAt: null,
      }),
      at(2026, 9, 3, 7),
    );
    expect(out).toHaveLength(PUMP_AHEAD);
    expect(out.every((n) => n.fireAt > at(2026, 9, 3, 7))).toBe(true);
    expect(out[0].fireAt).toBe(at(2026, 9, 3, 9));
  });

  it('schedules nothing while the pref is off', () => {
    const out = desiredScheduled(
      input({
        prefs: only({ pumpingReminders: false, pumpingEnabledAt: at(2026, 9, 1, 6) }),
        lastPumpAt: at(2026, 9, 1, 6),
      }),
      at(2026, 9, 1, 7),
    );
    expect(out).toEqual([]);
  });

  it('schedules nothing when there is no anchor at all', () => {
    const out = desiredScheduled(
      input({ prefs: only({ pumpingReminders: true, pumpingEnabledAt: null }), lastPumpAt: null }),
      at(2026, 9, 1, 7),
    );
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/notifications/scheduled.test.ts`
Expected: FAIL, `PUMP_AHEAD` is not exported.

- [ ] **Step 3: Implement**

In `src/notifications/scheduled.ts`, add above `desiredScheduled`:

```ts
/** How many pumping occurrences to schedule ahead. A repeating reminder built
 *  from one-shot triggers needs the app to reschedule after each fire; eight
 *  keeps the chain alive through roughly a day of the app never being opened. */
export const PUMP_AHEAD = 8;

function pumpReminders(input: ScheduleInput, now: number): ScheduledNotification[] {
  const { pumpingIntervalMin, pumpingEnabledAt } = input.prefs;
  const anchor = Math.max(input.lastPumpAt ?? 0, pumpingEnabledAt ?? 0);
  if (!anchor || pumpingIntervalMin <= 0) return [];
  const interval = pumpingIntervalMin * 60_000;
  // Deriving the first occurrence from `now` rather than blindly from the
  // anchor is what makes this self-healing: if every scheduled occurrence has
  // already passed, we re-enter the grid on phase instead of scheduling
  // nothing. The grid stays anchored, so identifiers only churn when an
  // occurrence actually passes.
  const first = Math.max(1, Math.ceil((now - anchor) / interval));
  const out: ScheduledNotification[] = [];
  for (let n = first; out.length < PUMP_AHEAD && n < first + PUMP_AHEAD + 1; n++) {
    const fireAt = anchor + n * interval;
    if (fireAt <= now) continue;
    out.push({
      // The fire time is in the identifier, matching the other three kinds:
      // title and body never change, so without fireAt here a changed interval
      // would recompute fireAt for the same anchor:n but leave the identifier
      // unchanged, and the diff would never notice.
      identifier: `${REMINDER_PREFIX}pump:${anchor}:${n}:${fireAt}`,
      kind: 'pump',
      title: 'Time to pump',
      // Deliberately no elapsed time: occurrence n fires n * interval after the
      // last pump, so a fixed "last pumped 3 hours ago" would be wrong for
      // every occurrence after the first.
      body: 'Tap to log a session.',
      fireAt,
      data: { url: '/timers' },
    });
  }
  return out;
}
```

Then extend `desiredScheduled`:

```ts
  if (input.prefs.pumpingReminders) {
    out.push(...pumpReminders(input, now));
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/notifications/scheduled.test.ts`
Expected: PASS, 39 tests.

- [ ] **Step 5: Add the pumping controls to the settings screen**

In `src/app/settings/notifications.tsx`, add the `Chip` import:

```ts
import { Chip } from '@/components/Chip';
```

Then read the two extra fields:

```ts
  const pumpingReminders = useAppStore((s) => s.pumpingReminders);
  const pumpingIntervalMin = useAppStore((s) => s.pumpingIntervalMin);
  const setPumpingInterval = useAppStore((s) => s.setPumpingInterval);
```

Add a fourth entry to the `rows` array and widen its `key` type to include `'pumpingReminders'`:

```ts
    {
      key: 'pumpingReminders',
      label: 'Pumping',
      hint: 'On a set interval from your last session.',
      on: pumpingReminders,
    },
```

Then add the interval picker below the group, visible only while the toggle is on:

```tsx
      {pumpingReminders && (
        <View style={{ ...group, marginTop: 12, padding: 16 }}>
          <Txt size={13} color={t.faint} style={{ marginBottom: 10 }}>
            Remind me every
          </Txt>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {[120, 180, 240, 300].map((min) => (
              <Chip
                key={min}
                label={`${min / 60}h`}
                color={t.primary}
                selected={pumpingIntervalMin === min}
                onPress={() => setPumpingInterval(min)}
              />
            ))}
          </View>
        </View>
      )}
```

`Chip` requires both `label: string` and `color: string` (`src/components/Chip.tsx:8-13`); `color` is not optional, which is why `t.primary` is passed above.

- [ ] **Step 6: Verify on web**

```bash
CI=1 npx expo start --web
```

At `/settings/notifications`, enable Pumping. Expected: the interval chips appear, selecting one persists across a reload, disabling hides them again.

- [ ] **Step 7: Typecheck, test, and commit**

```bash
npx tsc --noEmit
npm test
git add src/notifications/scheduled.ts src/notifications/scheduled.test.ts src/app/settings/notifications.tsx
git commit -m "feat(notifications): add pumping interval reminders"
```

---

## Final verification

- [ ] **Run the full suite**

```bash
npm test
npx tsc --noEmit
npm run lint
```

- [ ] **Drive the feature on a real Android build**

```bash
npx expo run:android
```

1. Complete setup as expecting, entering a due date eight days out. Grant the permission prompt.
2. Confirm in Android's notification settings that a "Reminders" channel exists alongside "Running timers", and that it is not silent.
3. Temporarily set a due date one day out, relaunch, and confirm via `adb shell dumpsys alarm | grep budkin` that a pending alarm exists.
4. Confirm the birth, relaunch, and confirm the due-date alarms are gone.
5. Start a tummy time timer, background the app for 45 minutes, and confirm the stale-timer notification arrives and opens `/timers`.

Step 3 is the one worth not skipping: it is the only check that the notification was actually handed to the OS rather than merely computed.
