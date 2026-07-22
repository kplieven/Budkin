# Nap Suggestion Reminder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify a parent as their baby approaches the upper end of the typical wake window for their age, suggesting a nap.

**Architecture:** A fifth `ReminderKind` on the existing scheduled-reminder mechanism. The pure layer (`scheduled.ts`) computes a fire instant from the end of the child's last sleep entry plus the `NORMS.wakeWindow` band for their age, minus a 15 minute lead. `scheduleSync.ts` projects the store into that pure layer, and `applySchedule.android.ts` reconciles it against the OS. No new native code.

**Tech Stack:** TypeScript, React Native (Expo), zustand, vitest, expo-notifications.

Spec: `docs/superpowers/specs/2026-07-22-nap-suggestion-reminder-design.md`

## Global Constraints

- **Android only.** The `applySchedule.ts` / `permission.ts` stubs stay no-ops. Nothing in this plan adds a platform branch.
- **The pure layer stays pure.** `scheduled.ts` makes no native calls, does no I/O, and never imports store types. It receives a narrow projection via `ScheduleInput`.
- **Copy hedges, never instructs.** Title is `<Name> may be ready for a nap`, never "Time for a nap". Body states the observation, not a directive.
- **No medical framing.** No mention of checkups, appointments, vaccinations, or development expectations. The settings hint must carry the words `General guidance, not medical advice.`
- **Off by default.** `napSuggestions` defaults to `false` in both `prefs.ts` and the store's initial state.
- **Quiet hours 07:00 to 19:00 local**, boundary `h >= 7 && h < 19`, matching `sleepTimer.ts`. Fire times outside are **dropped, not deferred**.
- **Age ceiling 365 days.** Never extrapolate past where `NORMS.wakeWindow` has data.
- **Never reuse `spanLabel`** from `scheduled.ts` for these durations. It renders 75 minutes as "1.25 hours". Use `fmtDur` from `@/lib/format`.
- **Run tests with:** `npx vitest run <path>` from the worktree root.
- **Worktree:** `/home/karlie/Repositories/budkin/.claude/worktrees/nap-suggestion`, branch `scheduled-reminders`. All commits land there. Never commit to `main`.

## File Structure

| File | Responsibility |
|---|---|
| `src/features/insights/norms.ts` | Owns the wake-window data **and** the age past which it must not be extrapolated |
| `src/notifications/scheduled.ts` | Pure: computes the desired nap notification from a projection |
| `src/notifications/scheduleSync.ts` | Projects store state into `ScheduleInput`, gates on the slices that matter |
| `src/data/prefs.ts` | Persisted `napSuggestions` flag |
| `src/store/useAppStore.ts` | In-memory `napSuggestions` state, setter, hydration |
| `src/app/settings/notifications.tsx` | The opt-in row and its disclaimer |

**One refinement on the spec's file table:** the spec put `NAP_MAX_AGE_DAYS` in `scheduled.ts`. This plan puts it in `norms.ts` as `WAKE_WINDOW_MAX_AGE_DAYS` instead. The ceiling is a property of the data (it is where the source's buckets stop), not of the notification that consumes it. Keeping it beside the buckets means a future edit to `NORMS.wakeWindow` sees the ceiling it has to keep in step.

**Task order:** Tasks 1 to 3 are independent plumbing that leave the tree compiling and green at every commit. Task 4 is the feature logic and depends on all three. Task 5 is the UI.

---

### Task 1: `wakeWindowBand` in norms.ts

**Files:**
- Modify: `src/features/insights/norms.ts`
- Test: `src/features/insights/norms.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `WAKE_WINDOW_MAX_AGE_DAYS: number` (365) and `wakeWindowBand(ageDays: number): NormBucket | null`. Task 4 uses both. `NormBucket` is the existing exported `{ maxAgeDays: number; lo: number; hi?: number }`.

- [ ] **Step 1: Write the failing test**

Append to `src/features/insights/norms.test.ts`:

```ts
describe('wakeWindowBand', () => {
  it('returns the band for each age bucket', () => {
    expect(wakeWindowBand(0)).toMatchObject({ lo: 45, hi: 60 });
    expect(wakeWindowBand(30)).toMatchObject({ lo: 45, hi: 60 });
    expect(wakeWindowBand(31)).toMatchObject({ lo: 60, hi: 90 });
    expect(wakeWindowBand(90)).toMatchObject({ lo: 60, hi: 90 });
    expect(wakeWindowBand(180)).toMatchObject({ lo: 90, hi: 120 });
    expect(wakeWindowBand(365)).toMatchObject({ lo: 120, hi: 180 });
  });

  it('returns null past the age the source covers, rather than extrapolating', () => {
    // bucketFor falls back to the last bucket forever, which is right for
    // drawing a chart band and wrong for scheduling a nap nudge.
    expect(wakeWindowBand(366)).toBeNull();
    expect(wakeWindowBand(1200)).toBeNull();
  });

  it('returns null for a negative age', () => {
    expect(wakeWindowBand(-1)).toBeNull();
  });
});
```

Add `wakeWindowBand` to the existing import from `./norms` at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/insights/norms.test.ts`
Expected: FAIL, `wakeWindowBand is not a function` (or a TS error that it is not exported).

- [ ] **Step 3: Write minimal implementation**

In `src/features/insights/norms.ts`, directly below the existing private `bucketFor`:

```ts
/**
 * The highest age `NORMS.wakeWindow` has data for. Past this, there is no
 * band: `bucketFor` deliberately falls back to the last bucket for any older
 * age, which is right for drawing a chart band but wrong for anything that
 * ACTS on the band. Without this ceiling a three-year-old's parent would be
 * nudged toward a nap on 12-month guidance, forever.
 *
 * Lives here rather than with the consumer because it describes the data: an
 * edit to the buckets above has to keep this in step.
 */
export const WAKE_WINDOW_MAX_AGE_DAYS = 365;

/** The wake-window band for a child of `ageDays`, or null outside the range
 *  the source covers. See WAKE_WINDOW_MAX_AGE_DAYS. */
export function wakeWindowBand(ageDays: number): NormBucket | null {
  if (ageDays < 0 || ageDays > WAKE_WINDOW_MAX_AGE_DAYS) return null;
  return bucketFor(NORMS.wakeWindow, ageDays);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/insights/norms.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add src/features/insights/norms.ts src/features/insights/norms.test.ts
git commit -m "feat(insights): expose the wake-window band with an explicit age ceiling"
```

---

### Task 2: `napSuggestions` preference and store state

**Files:**
- Modify: `src/data/prefs.ts`
- Modify: `src/store/useAppStore.ts` (state field, initial value, setter union, hydration)
- Test: `src/store/useAppStore.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: store state `napSuggestions: boolean` (default `false`), settable via the existing `setReminderPref(key, value)` whose key union now includes `'napSuggestions'`. Tasks 3 and 5 read it.

- [ ] **Step 1: Write the failing test**

Append these to the existing `describe('reminder preference persistence', ...)` block in `src/store/useAppStore.test.ts`. It already has the `s()` accessor, the mocked `savePrefs`, and the `h.prefs` hydration fixture in scope. Do not introduce new helpers.

```ts
  it('napSuggestions defaults to off, because it is advice rather than a fact', () => {
    expect(s().napSuggestions).toBe(false);
  });

  it('setReminderPref updates napSuggestions and persists', () => {
    useAppStore.setState({ napSuggestions: false });
    s().setReminderPref('napSuggestions', true);
    expect(s().napSuggestions).toBe(true);
    expect(savePrefs).toHaveBeenCalledWith({ napSuggestions: true });
  });

  it('hydrate applies a persisted napSuggestions, including a stored false', async () => {
    h.prefs = { napSuggestions: true };
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    useAppStore.setState({ napSuggestions: false });
    await s().hydrate();
    expect(s().napSuggestions).toBe(true);

    // `!= null`, not truthiness: a persisted false has to survive hydration.
    h.prefs = { napSuggestions: false };
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    useAppStore.setState({ napSuggestions: true });
    await s().hydrate();
    expect(s().napSuggestions).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/useAppStore.test.ts`
Expected: FAIL, `napSuggestions` is `undefined` and the key is rejected by `setReminderPref`'s type.

- [ ] **Step 3: Write minimal implementation**

In `src/data/prefs.ts`, inside `interface Prefs`, after `pumpingEnabledAt`:

```ts
  /** Nap suggestions. Off by default: unlike the other four this one gives
   *  advice, from a curve the app labels as not medical consensus. */
  napSuggestions: boolean;
```

In `src/store/useAppStore.ts`:

1. Beside the other reminder flags (around line 117, after `pumpingEnabledAt`), add to the state interface:

```ts
  napSuggestions: boolean;
```

2. Widen the `setReminderPref` key union (around line 201):

```ts
  setReminderPref: (
    key: 'dueDateReminders' | 'staleTimerReminders' | 'ageMilestones' | 'pumpingReminders' | 'napSuggestions',
```

3. In the initial state (around line 709, after `pumpingEnabledAt: null,`):

```ts
  napSuggestions: false,
```

4. In the hydrate prefs block (around line 837, after the `pumpingEnabledAt` line):

```ts
    if (prefs.napSuggestions != null) set({ napSuggestions: prefs.napSuggestions });
```

No change to `setReminderPref`'s body is needed: its generic branch already does `set({ [key]: value })` and `savePrefs({ [key]: value })`. Only the `pumpingReminders` early-return is special-cased, and nap has no anchor to stamp.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store/useAppStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/prefs.ts src/store/useAppStore.ts src/store/useAppStore.test.ts
git commit -m "feat(notifications): add the napSuggestions preference, off by default"
```

---

### Task 3: Project the wake anchor into `ScheduleInput`

Plumbing only. After this task `desiredScheduled` receives everything the nap logic needs but does not yet use it, so the tree compiles and stays green.

**Files:**
- Modify: `src/notifications/scheduled.ts` (the `ReminderPrefs` and `ScheduleInput` interfaces only)
- Modify: `src/notifications/scheduleSync.ts` (`toInput`, subscriber gate)
- Test: `src/notifications/scheduleSync.test.ts`
- Test: `src/notifications/scheduled.test.ts` (fix the builders that a required field breaks)

**Interfaces:**
- Consumes: `napSuggestions` from Task 2.
- Produces: `ScheduleInput` gains `lastSleepEndByChild: Record<string, number>` and `selectedChildId: string`. `ReminderPrefs` gains `napSuggestions: boolean`. Task 4 reads all three.

- [ ] **Step 1: Write the failing test**

Append to `src/notifications/scheduleSync.test.ts`, using that file's existing `setup()` helper:

```ts
describe('nap anchor projection', () => {
  it('projects the latest ended sleep per child, and the selected child', async () => {
    const { store, desiredScheduled } = await setup();
    store.setState({
      selectedChildId: 'c1',
      entries: [
        { id: 'e1', childId: 'c1', type: 'sleep', start: 1_000, end: 2_000, nap: true, tags: [] },
        { id: 'e2', childId: 'c1', type: 'sleep', start: 3_000, end: 4_000, nap: true, tags: [] },
        { id: 'e3', childId: 'c2', type: 'sleep', start: 5_000, end: 6_000, nap: true, tags: [] },
        // still running: no end, so it must not become an anchor
        { id: 'e4', childId: 'c1', type: 'sleep', start: 9_000, end: null, nap: true, tags: [] },
      ],
    });
    await flush();
    const input = vi.mocked(desiredScheduled).mock.calls.at(-1)?.[0];
    expect(input?.lastSleepEndByChild).toEqual({ c1: 4_000, c2: 6_000 });
    expect(input?.selectedChildId).toBe('c1');
  });

  it('reconciles when napSuggestions changes', async () => {
    const { store, desiredScheduled } = await setup();
    await flush();
    const before = vi.mocked(desiredScheduled).mock.calls.length;
    store.getState().setReminderPref('napSuggestions', true);
    await flush();
    expect(vi.mocked(desiredScheduled).mock.calls.length).toBeGreaterThan(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notifications/scheduleSync.test.ts`
Expected: FAIL, `lastSleepEndByChild` is `undefined`, and the napSuggestions change does not trigger a reconcile.

- [ ] **Step 3: Write minimal implementation**

In `src/notifications/scheduled.ts`, add to `interface ReminderPrefs`:

```ts
  napSuggestions: boolean;
```

and to `interface ScheduleInput`:

```ts
  /** Per child, the end of their most recent ENDED sleep entry. The instant
   *  the current wake window started. Absent when they have never slept on
   *  record. */
  lastSleepEndByChild: Record<string, number>;
  /** Resolves a running timer that carries no `childId` (one started from the
   *  headless widget). Mirrors `useAppStore.ts:600`. */
  selectedChildId: string;
```

In `src/notifications/scheduleSync.ts`, replace the body of `toInput` with:

```ts
function toInput(s: State): ScheduleInput {
  let lastPumpAt: number | null = null;
  const lastSleepEndByChild: Record<string, number> = {};
  for (const e of s.entries) {
    if (e.type === 'pumping') {
      const at = e.end ?? e.start;
      if (lastPumpAt === null || at > lastPumpAt) lastPumpAt = at;
      continue;
    }
    // Only an ENDED sleep starts a wake window. A running one means the baby
    // is still asleep, and `timers` already covers that case.
    if (e.type === 'sleep' && e.end != null) {
      const cur = lastSleepEndByChild[e.childId];
      if (cur == null || e.end > cur) lastSleepEndByChild[e.childId] = e.end;
    }
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
      napSuggestions: s.napSuggestions,
    },
    lastPumpAt,
    lastSleepEndByChild,
    selectedChildId: s.selectedChildId,
  };
}
```

In the same file's subscriber gate, add one line to the equality chain (the `selectedChildId` is deliberately NOT gated on: it only disambiguates an ownerless timer, and `timers` is already gated):

```ts
      state.pumpingEnabledAt === previous.pumpingEnabledAt &&
      state.napSuggestions === previous.napSuggestions
    ) {
```

In `src/notifications/scheduled.test.ts`, extend the two builders so the new required fields have defaults:

```ts
const prefs = (over: Partial<ReminderPrefs> = {}): ReminderPrefs => ({
  dueDateReminders: true,
  staleTimerReminders: true,
  ageMilestones: true,
  pumpingReminders: false,
  pumpingIntervalMin: 180,
  pumpingEnabledAt: null,
  napSuggestions: false,
  ...over,
});

const input = (over: Partial<ScheduleInput> = {}): ScheduleInput => ({
  children: [],
  timers: [],
  prefs: prefs(),
  lastPumpAt: null,
  lastSleepEndByChild: {},
  selectedChildId: 'c1',
  ...over,
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/notifications/`
Expected: PASS. Every pre-existing test in `scheduled.test.ts` and `scheduleSync.test.ts` stays green, since `napSuggestions` defaults to `false` and no reminder reads the new fields yet.

- [ ] **Step 5: Commit**

```bash
git add src/notifications/scheduled.ts src/notifications/scheduleSync.ts src/notifications/scheduled.test.ts src/notifications/scheduleSync.test.ts
git commit -m "feat(notifications): project the wake anchor and selected child into ScheduleInput"
```

---

### Task 4: The nap reminder

The feature logic. Everything it consumes exists after Tasks 1 to 3.

**Files:**
- Modify: `src/notifications/scheduled.ts`
- Test: `src/notifications/scheduled.test.ts`

**Interfaces:**
- Consumes: `wakeWindowBand` (Task 1, which enforces the age ceiling internally by returning null); `napSuggestions`, `lastSleepEndByChild`, `selectedChildId` on `ScheduleInput` (Tasks 2 and 3); `fmtDur` from `@/lib/format`.
- Produces: `ReminderKind` gains `'nap'`. Exports `NAP_LEAD_MIN`, `NAP_DAY_START_HOUR`, `NAP_DAY_END_HOUR`.

- [ ] **Step 1: Write the failing test**

Append to `src/notifications/scheduled.test.ts`. Note `at()` builds local time, so the quiet-hours assertions hold in any timezone.

```ts
describe('nap suggestions', () => {
  // Born 2026-09-01. At `now` below she is 60 days old, so band 60 to 90,
  // firing at 90 - 15 = 75 minutes awake.
  const born = at(2026, 9, 1);
  const rowan = () => child({ id: 'c1', first: 'Rowan', birth: born });
  const now = at(2026, 10, 31, 10); // 10:00 local, age 60 days
  const napPrefs = { napSuggestions: true };

  const napInput = (over: Partial<ScheduleInput> = {}) =>
    input({
      children: [rowan()],
      prefs: prefs(napPrefs),
      lastSleepEndByChild: { c1: at(2026, 10, 31, 9) }, // woke 09:00
      ...over,
    });

  const naps = (i: ScheduleInput, t = now) =>
    desiredScheduled(i, t).filter((n) => n.kind === 'nap');

  it('fires 15 minutes before the upper bound of the age band', () => {
    const [n] = naps(napInput());
    expect(n.fireAt).toBe(at(2026, 10, 31, 10) + 15 * 60_000); // 09:00 + 1h15
    expect(n.title).toBe('Rowan may be ready for a nap');
    expect(n.body).toBe('Awake 1h 15m.');
    expect(n.data.url).toBe('/timers');
    expect(n.identifier).toBe(`${REMINDER_PREFIX}nap:c1:${n.fireAt}`);
  });

  it('uses each age band', () => {
    const cases: [number, number][] = [
      [10, 45],   // to 30 days:  band hi 60
      [60, 75],   // to 90 days:  band hi 90
      [120, 105], // to 180 days: band hi 120
      [300, 165], // to 365 days: band hi 180
    ];
    for (const [ageDays, awakeMin] of cases) {
      const t = born + ageDays * 86_400_000;
      const woke = new Date(t);
      woke.setHours(9, 0, 0, 0);
      const at9 = woke.getTime();
      const [n] = naps(
        napInput({ lastSleepEndByChild: { c1: at9 } }),
        at9 + 60_000, // one minute after waking
      );
      expect(n.fireAt - at9).toBe(awakeMin * 60_000);
    }
  });

  it('is off unless the preference is on', () => {
    expect(naps(napInput({ prefs: prefs({ napSuggestions: false }) }))).toEqual([]);
  });

  it('says nothing while the child is asleep', () => {
    const t = timer({ id: 't1', childId: 'c1', saveAs: 'sleep' });
    expect(naps(napInput({ timers: [t] }))).toEqual([]);
  });

  it('resolves an ownerless sleep timer to the selected child', () => {
    // A timer started from the headless widget carries no childId.
    const t = timer({ id: 't1', childId: undefined, saveAs: 'sleep' });
    expect(naps(napInput({ timers: [t], selectedChildId: 'c1' }))).toEqual([]);
    // ...and must not suppress a DIFFERENT child's nudge.
    expect(naps(napInput({ timers: [t], selectedChildId: 'c2' })).length).toBe(1);
  });

  it('says nothing without an anchor', () => {
    expect(naps(napInput({ lastSleepEndByChild: {} }))).toEqual([]);
  });

  it('says nothing for an expecting child', () => {
    expect(naps(napInput({ children: [child({ id: 'c1', expected: true, birth: born })] }))).toEqual([]);
  });

  it('stops past the age the wake-window source covers', () => {
    const t = born + 366 * 86_400_000;
    const woke = new Date(t);
    woke.setHours(9, 0, 0, 0);
    expect(
      naps(napInput({ lastSleepEndByChild: { c1: woke.getTime() } }), woke.getTime() + 60_000),
    ).toEqual([]);
  });

  it('does not schedule a fire time already past', () => {
    // Woke at 09:00, fire is 10:15, and it is already 11:00.
    expect(naps(napInput(), at(2026, 10, 31, 11))).toEqual([]);
  });

  describe('quiet hours', () => {
    it('drops a fire time at or after 19:00', () => {
      // Woke 17:45 + 1h15 = exactly 19:00. Excluded.
      const woke = at(2026, 10, 31, 17) + 45 * 60_000;
      expect(naps(napInput({ lastSleepEndByChild: { c1: woke } }), woke + 60_000)).toEqual([]);
    });

    it('keeps a fire time at exactly 07:00', () => {
      // Woke 05:45 + 1h15 = exactly 07:00. Included.
      const woke = at(2026, 10, 31, 5) + 45 * 60_000;
      const [n] = naps(napInput({ lastSleepEndByChild: { c1: woke } }), woke + 60_000);
      expect(n.fireAt).toBe(at(2026, 10, 31, 7));
    });

    it('drops rather than defers an overnight window', () => {
      // Woke 03:00, would fire 04:15. Nothing is scheduled, and in particular
      // nothing is pushed to 07:00: by then the anchor is stale.
      const woke = at(2026, 10, 31, 3);
      expect(naps(napInput({ lastSleepEndByChild: { c1: woke } }), woke + 60_000)).toEqual([]);
    });
  });

  it('re-anchors to a newer sleep, so the diff reschedules', () => {
    const first = naps(napInput())[0];
    const later = naps(napInput({ lastSleepEndByChild: { c1: at(2026, 10, 31, 9) + 30 * 60_000 } }))[0];
    expect(later.identifier).not.toBe(first.identifier);
    const { toSchedule, toCancel } = diffScheduled(
      [{ identifier: first.identifier, title: first.title, body: first.body }],
      [later],
    );
    expect(toCancel).toEqual([first.identifier]);
    expect(toSchedule).toEqual([later]);
  });

  it('handles two awake children independently', () => {
    const out = naps(
      napInput({
        children: [rowan(), child({ id: 'c2', first: 'Sam', birth: born })],
        lastSleepEndByChild: { c1: at(2026, 10, 31, 9), c2: at(2026, 10, 31, 9) + 20 * 60_000 },
      }),
    );
    expect(out.map((n) => n.title)).toEqual([
      'Rowan may be ready for a nap',
      'Sam may be ready for a nap',
    ]);
  });

  it('one child napping does not suppress the other', () => {
    const out = naps(
      napInput({
        children: [rowan(), child({ id: 'c2', first: 'Sam', birth: born })],
        timers: [timer({ id: 't1', childId: 'c1', saveAs: 'sleep' })],
        lastSleepEndByChild: { c1: at(2026, 10, 31, 9), c2: at(2026, 10, 31, 9) },
      }),
    );
    expect(out.map((n) => n.title)).toEqual(['Sam may be ready for a nap']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notifications/scheduled.test.ts`
Expected: FAIL. Every assertion in the new block fails because no notification has `kind: 'nap'`, so `naps()` returns `[]`.

- [ ] **Step 3: Write minimal implementation**

In `src/notifications/scheduled.ts`:

1. Add imports at the top, beside the existing ones:

```ts
import { wakeWindowBand } from '@/features/insights/norms';
import { fmtDur } from '@/lib/format';
```

2. Widen the kind union:

```ts
export type ReminderKind = 'due' | 'stale' | 'age' | 'pump' | 'nap';
```

3. Add the constants and the reminder, after `pumpReminders`:

```ts
/** Minutes before the band's upper bound that the nudge fires. Firing AT the
 *  bound would announce the parent is already late, and the overtired window
 *  has arrived by then. */
export const NAP_LEAD_MIN = 15;

/** Local hours the nudge may fire in. The same boundary `sleepTimer.ts` uses
 *  to default a sleep entry's `nap` flag, so "nap" means one thing app-wide. */
export const NAP_DAY_START_HOUR = 7;
export const NAP_DAY_END_HOUR = 19;

const DAY_MS = 86_400_000;

function withinNapHours(ms: number): boolean {
  const h = new Date(ms).getHours();
  return h >= NAP_DAY_START_HOUR && h < NAP_DAY_END_HOUR;
}

/**
 * Suggests a nap as the child nears the upper end of the typical wake window
 * for their age, anchored to the end of their last sleep.
 *
 * The only reminder here that gives ADVICE rather than reporting a fact, and
 * it is built on a rule of thumb the app itself labels as not medical
 * consensus (see NORMS.wakeWindow). Hence the hedged title, the body that
 * states the observation instead of an instruction, and the preference that
 * ships off.
 */
function napReminders(child: Child, input: ScheduleInput, now: number): ScheduledNotification[] {
  // `birth` holds a DUE date while expecting, so there is no age.
  if (child.expected) return [];
  // Null past the age the source covers, rather than extrapolating forever.
  const band = wakeWindowBand((now - child.birth) / DAY_MS);
  if (band?.hi == null) return [];

  // Asleep right now, so there is nothing to suggest. A timer started from the
  // headless widget carries no childId and belongs to the selected child.
  const asleep = input.timers.some(
    (t) => t.saveAs === 'sleep' && (t.childId ?? input.selectedChildId) === child.id,
  );
  if (asleep) return [];

  const wokeAt = input.lastSleepEndByChild[child.id];
  if (wokeAt == null) return [];

  const awakeMin = band.hi - NAP_LEAD_MIN;
  const fireAt = wokeAt + awakeMin * 60_000;
  if (fireAt <= now) return [];
  // Dropped, NOT deferred to the morning: a window that elapses at 21:00 is
  // meaningless by 07:00, because the baby has slept the night in between and
  // the anchor that justified it is stale.
  if (!withinNapHours(fireAt)) return [];

  return [
    {
      // The fire time is in the identifier, as with pump: logging a sleep
      // moves the anchor, and title/body alone carry too little signal for the
      // diff to notice.
      identifier: `${REMINDER_PREFIX}nap:${child.id}:${fireAt}`,
      kind: 'nap',
      // Hedged on purpose. The app has a population rule of thumb; the parent
      // has an actual baby in front of them.
      title: `${child.first} may be ready for a nap`,
      // `spanLabel` above assumes whole hours and would render this as
      // "1.25 hours". fmtDur gives "1h 15m".
      body: `Awake ${fmtDur(awakeMin)}.`,
      fireAt,
      data: { url: '/timers' },
    },
  ];
}
```

4. Wire it into `desiredScheduled`, after the pumping branch:

```ts
  if (input.prefs.napSuggestions) {
    for (const c of input.children) out.push(...napReminders(c, input, now));
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/notifications/`
Expected: PASS, including every pre-existing test in both notification test files.

- [ ] **Step 5: Commit**

```bash
git add src/notifications/scheduled.ts src/notifications/scheduled.test.ts
git commit -m "feat(notifications): suggest a nap as the wake window closes"
```

---

### Task 5: The settings toggle

**Files:**
- Modify: `src/app/settings/notifications.tsx`

**Interfaces:**
- Consumes: `napSuggestions` and `setReminderPref` from Task 2.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Widen the row key union**

In `src/app/settings/notifications.tsx`, line 20:

```ts
type ReminderKey =
  | 'dueDateReminders'
  | 'staleTimerReminders'
  | 'ageMilestones'
  | 'napSuggestions'
  | 'pumpingReminders';
```

- [ ] **Step 2: Read the new state**

Beside the other selectors, after the `ageMilestones` line:

```ts
  const napSuggestions = useAppStore((s) => s.napSuggestions);
```

Each selector returns a primitive, so this does not trip the zustand v5 new-reference rule that blank-screens web routes.

- [ ] **Step 3: Add the row**

In the `rows` array, between the `ageMilestones` and `pumpingReminders` entries (grouping it with the other sleep-shaped reminder, and keeping pumping last since it owns the interval panel below):

```ts
    {
      key: 'napSuggestions',
      label: 'Nap suggestions',
      hint: 'As your baby nears the typical wake window for their age. General guidance, not medical advice.',
      on: napSuggestions,
    },
```

The hint is the only place the parent sees the basis for the nudge before opting in. Insights shows a disclaimer beside this same curve, so this must not carry less.

- [ ] **Step 4: Verify it renders and toggles**

The rows are data-driven, so no JSX change is needed: `rows.map` picks it up, and the existing `onPress={() => setReminderPref(r.key, !r.on)}` already handles it.

Run the app on web and open `/settings/notifications`:

```bash
CI=1 BROWSER=none npx expo start --web --port 8081 --clear
```

Expected: five rows, "Nap suggestions" fourth, its toggle off, its hint ending "General guidance, not medical advice." Tapping it flips the toggle on. Reload the page: it is still on.

Note the two-line hint is longer than the others. Check it wraps rather than clipping, and that the row's toggle stays vertically aligned.

- [ ] **Step 5: Commit**

```bash
git add src/app/settings/notifications.tsx
git commit -m "feat(notifications): add the nap suggestions toggle"
```

---

## Final verification

- [ ] **Full test suite**

Run: `npx vitest run`
Expected: PASS, no regressions.

- [ ] **Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, apart from the three known pre-existing `expo-image-picker` errors (`photo.ts`, `Sidebar.tsx` x2) if that dependency is uninstalled in the checkout. Those are not from this work.

- [ ] **Confirm branch isolation**

```bash
git rev-parse --abbrev-ref HEAD   # must print: scheduled-reminders
git log --oneline main -1          # must be unchanged
```

## Notes for the implementer

- The nap reminder is **Android only in effect**, like the other four. On web and iOS `applySchedule.ts` is a no-op stub, so the settings toggle persists but nothing is ever delivered. That is existing, intended behaviour, and the screen already explains it in its "Android only" branch.
- **Do not add an escalation or a repeat.** One nudge per wake window. A second one is the nagging the scheduled-reminders spec explicitly ruled out.
- If `npx expo start` fails with `PluginError: Failed to resolve plugin for module "expo-image-picker"`, run `npm install` first. It leaves `package.json` and the lockfile unchanged.
