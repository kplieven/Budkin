# Treatment reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify a parent on Android when a dose of a treatment (a `Cure`) is due, and land the tap on a medication sheet already seeded from that treatment.

**Architecture:** A sixth `ReminderKind` on the existing scheduled-reminder mechanism. All the decision logic goes in the pure, `now`-parametrised `src/notifications/scheduled.ts` (no I/O, no native calls, no store types); `src/notifications/scheduleSync.ts` projects the store into it and the existing `desiredScheduled` -> `diffScheduled` -> `applySchedule.android` reconcile does the rest. The notification's `data.url` points at the existing `/log/medication` deep link with a new `cure` query parameter, which calls the store's existing `logMedicationFromCure`.

**Tech Stack:** TypeScript, Expo SDK 56, expo-router, expo-notifications, zustand v5, vitest.

## Global Constraints

- **Expo version:** SDK 56. Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any Expo-facing code. No task in this plan adds a new Expo API, so this should not come up, but the rule stands.
- **No em-dashes** anywhere: prose, docs, code comments, UI copy, commit messages. Use commas, colons, or separate sentences.
- **Android only.** Off Android, `src/notifications/permission.ts` is a permanent-no stub and `applyScheduled` never schedules. Nothing in this plan needs a platform check of its own; the existing layer handles it.
- **zustand v5:** never return a new reference from a `useAppStore` selector. No inline `.filter`/`.map` in a selector. Select the raw array and derive in the render body. Violating this blank-screens the web build with "Maximum update depth exceeded".
- **vitest config is `include: ['src/**/*.test.ts']`, `environment: 'node'`.** Only `.ts` test files run, and there is no component-test harness (no testing-library, no jsdom) anywhere in the repo. Route and component logic must be extracted into a pure `.ts` module to be testable. Do not add `.tsx` tests and do not widen the vitest config.
- **Verification commands** (run from the repo root, all three must be clean before any commit):
  - `npx tsc --noEmit`
  - `npx vitest run`
  - `npx expo lint`
- **Baseline:** 1289 tests across 49 files pass before this plan starts. If the baseline is not green, stop and report rather than building on it.
- **Commit style:** conventional commits, lowercase scope, e.g. `feat(notifications): ...`.
- **Source of truth:** `docs/superpowers/specs/2026-07-27-treatment-reminders-design.md`. Where this plan and the spec disagree, the spec wins; raise it rather than silently diverging.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/data/prefs.ts` | persisted shape of the two new prefs | 1 |
| `src/store/useAppStore.ts` | the two prefs in state, defaults, hydrate, and the switch-on stamp | 1 |
| `src/store/useAppStore.test.ts` | pref persistence and stamp tests | 1 |
| `src/store/selectors.ts` | export `timeOfDaySlotMs`; add `cureDoseScalars`, the single home of dose-to-cure name attribution | 2 |
| `src/store/selectors.test.ts` | `cureDoseScalars` tests | 2 |
| `src/features/cures/cureLabels.ts` | export `TIME_OF_DAY_ORDER` so notification order matches label order | 3 |
| `src/notifications/scheduled.ts` | `'cure'` kind, `CURE_AHEAD`/`CURE_MAX_DAYS`, `cureReminders()`, the two new `ScheduleInput` fields and two new `ReminderPrefs` fields | 2, 3, 4 |
| `src/notifications/scheduled.test.ts` | all `cureReminders` behaviour | 3, 4 |
| `src/notifications/scheduleSync.ts` | project `cures` and `cureDoses`; extend the change gate | 2 |
| `src/notifications/scheduleSync.test.ts` | projection and gate tests | 2 |
| `src/app/settings/notifications.tsx` | the Treatments row | 5 |
| `src/lib/logDeepLink.ts` | **new.** Pure routing decision for `babybuddy://log/<type>`, extracted so it is testable under the node-only vitest config | 6 |
| `src/lib/logDeepLink.test.ts` | **new.** Resolver tests | 6 |
| `src/app/log/[type].tsx` | thin view: read params, call the resolver, dispatch | 6 |

**Ordering rationale.** Task 2 extends `ReminderPrefs` and `ScheduleInput` *and* fixes up `scheduleSync.ts` in the same task, because the type extension breaks `toInput`'s return type until the projection exists. Every task in this plan leaves `tsc` and the full suite green.

---

### Task 1: Persisted preferences and the reset lever

Adds `treatmentReminders` (default **on**) and `treatmentRemindersEnabledAt` to the prefs file and the store. Nothing reads them yet, so this task changes no behaviour beyond a new settings-backed boolean existing.

**Files:**
- Modify: `src/data/prefs.ts:33` (after `napSuggestions`)
- Modify: `src/store/useAppStore.ts:143`, `:266`, `:969`, `:1046-1058`, `:1147`
- Test: `src/store/useAppStore.test.ts` (append to the reminder-pref describe block that starts near `:4754`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `Prefs.treatmentReminders: boolean`
  - `Prefs.treatmentRemindersEnabledAt: number | null`
  - `AppState.treatmentReminders: boolean`
  - `AppState.treatmentRemindersEnabledAt: number | null`
  - `setReminderPref` accepts the extra key `'treatmentReminders'`

- [ ] **Step 1: Write the failing tests**

Append to `src/store/useAppStore.test.ts`, inside the same `describe` that already holds `setReminderPref updates state and persists via savePrefs for a plain toggle` (near line 4754). `s`, `savePrefs`, `NOW` and `h` are already defined in that file's scope; do not redeclare them.

```ts
  it('treatmentReminders defaults on', () => {
    expect(useAppStore.getState().treatmentReminders).toBe(true);
  });

  it('switching treatmentReminders ON stamps treatmentRemindersEnabledAt with the current time', () => {
    useAppStore.setState({ treatmentReminders: false, treatmentRemindersEnabledAt: null });
    const before = Date.now();
    s().setReminderPref('treatmentReminders', true);
    const after = Date.now();
    expect(s().treatmentReminders).toBe(true);
    expect(s().treatmentRemindersEnabledAt).not.toBeNull();
    expect(s().treatmentRemindersEnabledAt as number).toBeGreaterThanOrEqual(before);
    expect(s().treatmentRemindersEnabledAt as number).toBeLessThanOrEqual(after);
    expect(savePrefs).toHaveBeenCalledWith({
      treatmentReminders: true,
      treatmentRemindersEnabledAt: s().treatmentRemindersEnabledAt,
    });
  });

  it('switching treatmentReminders OFF clears treatmentRemindersEnabledAt to null', () => {
    useAppStore.setState({ treatmentReminders: true, treatmentRemindersEnabledAt: NOW });
    s().setReminderPref('treatmentReminders', false);
    expect(s().treatmentReminders).toBe(false);
    expect(s().treatmentRemindersEnabledAt).toBeNull();
    expect(savePrefs).toHaveBeenCalledWith({
      treatmentReminders: false,
      treatmentRemindersEnabledAt: null,
    });
  });

  it('hydrate applies persisted treatment reminder prefs', async () => {
    h.prefs = { treatmentReminders: false, treatmentRemindersEnabledAt: 1234 };
    await s().hydrate();
    expect(s().treatmentReminders).toBe(false);
    expect(s().treatmentRemindersEnabledAt).toBe(1234);
  });
```

Note on the last test: read the surrounding `hydrate applies persisted reminder prefs` test at `:4802` first and copy its exact setup idiom (how `h.prefs` is seeded and whether it needs a reset). Match it rather than the sketch above if they differ.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/store/useAppStore.test.ts`
Expected: FAIL. The two stamp tests fail on `Argument of type '"treatmentReminders"' is not assignable`, and the default test fails with `expected undefined to be true`.

- [ ] **Step 3: Add the persisted prefs**

In `src/data/prefs.ts`, immediately after the `napSuggestions` field (line 33):

```ts
  /**
   * Treatment (cure) dose reminders. On by default, unlike naps and pumping:
   * this one reports back a schedule the parent authored rather than offering
   * advice, and it is inert until they create a treatment, so defaulting it on
   * cannot surprise anyone who does not use the feature.
   */
  treatmentReminders: boolean;
  /**
   * When the treatments toggle was last switched on, epoch ms. The resync lever
   * for a drifting interval grid, exactly like `pumpingEnabledAt`: a dose given
   * but not logged leaves the reminder early, and toggling off and on rebases
   * the phase to now. It can only ever MOVE an existing grid, never start one.
   * See `cureReminders` in src/notifications/scheduled.ts.
   */
  treatmentRemindersEnabledAt: number | null;
```

- [ ] **Step 4: Add the store state, default, key union and hydrate**

In `src/store/useAppStore.ts`:

After `napSuggestions: boolean;` in the `AppState` interface (line 143):

```ts
  treatmentReminders: boolean;
  /** when the treatments toggle was last switched on, epoch ms */
  treatmentRemindersEnabledAt: number | null;
```

Replace the `setReminderPref` signature (lines 265 to 267) with:

```ts
  setReminderPref: (
    key:
      | 'dueDateReminders'
      | 'staleTimerReminders'
      | 'ageMilestones'
      | 'pumpingReminders'
      | 'napSuggestions'
      | 'treatmentReminders',
    value: boolean,
  ) => void;
```

Read the existing three lines before replacing and keep the `value` parameter exactly as it already is.

After `napSuggestions: false,` in the initial state (line 969):

```ts
  treatmentReminders: true,
  treatmentRemindersEnabledAt: null,
```

After the `napSuggestions` hydrate line (line 1147):

```ts
    if (prefs.treatmentReminders != null) set({ treatmentReminders: prefs.treatmentReminders });
    // `!== undefined`, not `!= null`: a persisted null is a real value here
    // (the toggle is off) and must not be skipped. Matches pumpingEnabledAt.
    if (prefs.treatmentRemindersEnabledAt !== undefined)
      set({ treatmentRemindersEnabledAt: prefs.treatmentRemindersEnabledAt });
```

- [ ] **Step 5: Add the switch-on stamp**

In `setReminderPref` (line 1046), directly after the closing brace of the existing `if (key === 'pumpingReminders')` block and before the generic `set(...)`:

```ts
    if (key === 'treatmentReminders') {
      // The same resync lever pumping has, for the same gap: a parent who gives
      // a dose and forgets to log it gets a reminder that is early, with no way
      // to nudge it. Toggling off and on rebases the phase to now.
      //
      // One deliberate difference from pumping. This stamp can only ever MOVE an
      // existing interval grid, never bring one into being: `cureReminders`
      // returns early when the cure has no logged dose, before it consults this
      // value. It also does nothing at all to a times-of-day cure, whose instants
      // come off the wall clock rather than a phase. See scheduled.ts.
      const treatmentRemindersEnabledAt = value ? Date.now() : null;
      set({ treatmentReminders: value, treatmentRemindersEnabledAt });
      void savePrefs({ treatmentReminders: value, treatmentRemindersEnabledAt });
      return;
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/store/useAppStore.test.ts`
Expected: PASS, including the four new tests.

- [ ] **Step 7: Full verification**

Run: `npx tsc --noEmit && npx vitest run && npx expo lint`
Expected: no type errors, all tests pass, no new lint errors.

If `expo lint` reports pre-existing problems in `src/features/cures/CureEditor.tsx` or `src/notifications/sync.test.ts`, confirm they are pre-existing with `git diff --stat main -- <path>` (an empty diff proves the file is byte-identical to main) and leave them alone.

- [ ] **Step 8: Commit**

```bash
git add src/data/prefs.ts src/store/useAppStore.ts src/store/useAppStore.test.ts
git commit -m "feat(notifications): add the treatment reminders preference and its resync stamp"
```

---

### Task 2: Dose scalars and the store projection

Extends `ScheduleInput` and `ReminderPrefs` with everything `cureReminders` will need, and fills them in `scheduleSync`. `desiredScheduled` still emits no cure reminders at the end of this task; the inputs simply arrive.

Dose attribution is by NAME (trimmed, lowercased), because a `MedicationEntry` carries no reference back to the cure and cannot be given one: Baby Buddy has no such field, so a `cureId` would be dropped the moment the dose round-trips. That rule already lives in `dosesForCure` in `selectors.ts`, so the new scalar helper goes there too rather than re-implementing the matching in the notifications layer.

**Files:**
- Modify: `src/store/selectors.ts:445` (export `timeOfDaySlotMs`), and append `cureDoseScalars` after `cureDueState` (after line 512)
- Modify: `src/notifications/scheduled.ts:48-84` (`ReminderPrefs`, `ScheduleInput`)
- Modify: `src/notifications/scheduleSync.ts:24-68` (`toInput`), `:88-107` (`run`), `:155-170` (change gate)
- Test: `src/store/selectors.test.ts`, `src/notifications/scheduleSync.test.ts`
- Also modify: `src/notifications/scheduled.test.ts` (the `prefs()` and `input()` factories must gain the new fields or every existing test fails to typecheck)

**Interfaces:**
- Consumes: `AppState.treatmentReminders`, `AppState.treatmentRemindersEnabledAt` (Task 1).
- Produces:
  - `export function timeOfDaySlotMs(todayMidnight: number, tod: CureTimeOfDay): number` in `selectors.ts`
  - `export function cureDoseScalars(cures: Cure[], entries: Entry[], now: number): Record<string, { today: number; lastAt: number | null }>` in `selectors.ts`
  - `ReminderPrefs.treatmentReminders: boolean`, `ReminderPrefs.treatmentRemindersEnabledAt: number | null`
  - `ScheduleInput.cures: Cure[]`, `ScheduleInput.cureDoses: Record<string, { today: number; lastAt: number | null }>`

- [ ] **Step 1: Write the failing test for `cureDoseScalars`**

Add this as a nested `describe` INSIDE the existing `describe('cureDueState / cureDueList / cureDueHint / curesAllGiven', ...)` block in `src/store/selectors.test.ts` (it starts at line 566), so it reuses that block's fixtures rather than growing a second set. Those fixtures are, verbatim from the file:

- `at(h, min = 0)` is 4 March 2026 at that local time
- `dayAt(d, h)` is that day of March 2026 at that local hour
- `cure(over?)` builds an Omeprazol times-of-day cure, id `cure-1`, child `c1`
- `dose(time, name = 'Omeprazol', childId = 'c1')` builds a medication `Entry`, **time first**, with `tags: []` already set

```ts
  describe('cureDoseScalars', () => {
    it("counts today's doses and reports the latest dose instant", () => {
      const out = cureDoseScalars([cure()], [dayAt(3, 8), at(8), at(12)].map((t) => dose(t)), at(14));
      expect(out['cure-1']).toEqual({ today: 2, lastAt: at(12) });
    });

    it('matches a dose to its cure by trimmed, case-insensitive name', () => {
      const out = cureDoseScalars([cure()], [dose(at(8), '  omeprazol ')], at(14));
      expect(out['cure-1'].today).toBe(1);
    });

    it('ignores a dose for a different medication', () => {
      const out = cureDoseScalars([cure()], [dose(at(8), 'Paracetamol')], at(14));
      expect(out['cure-1']).toEqual({ today: 0, lastAt: null });
    });

    it('reports a cure with no doses at all rather than omitting it', () => {
      expect(cureDoseScalars([cure()], [], at(14))['cure-1']).toEqual({ today: 0, lastAt: null });
    });

    it('ignores a dose stamped in the future, matching cureDueState', () => {
      const out = cureDoseScalars([cure()], [dose(at(20))], at(14));
      expect(out['cure-1']).toEqual({ today: 0, lastAt: null });
    });

    it('keys every cure it is given', () => {
      const out = cureDoseScalars([cure(), cure({ id: 'cure-2', name: 'Amoxicilline' })], [dose(at(8))], at(14));
      expect(Object.keys(out).sort()).toEqual(['cure-1', 'cure-2']);
      expect(out['cure-2']).toEqual({ today: 0, lastAt: null });
    });
  });
```

Add `cureDoseScalars` to that file's import from `@/store/selectors`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/store/selectors.test.ts`
Expected: FAIL with `cureDoseScalars is not a function` (or a TS error that it is not exported).

- [ ] **Step 3: Implement `cureDoseScalars` and export `timeOfDaySlotMs`**

In `src/store/selectors.ts`, change the `timeOfDaySlotMs` declaration (line 445) from `function` to `export function`. It keeps its existing doc comment and body unchanged; `cureReminders` needs the same DST-safe slot construction in Task 3 and must not grow a second copy of it.

Then append after `cureDueState` (after line 512):

```ts
/**
 * The two per-cure dose facts the reminder layer needs, keyed by cure id: how
 * many doses were logged today, and the instant of the most recent one.
 *
 * Lives here rather than in the notifications layer so that dose-to-cure name
 * attribution has exactly one home. Both figures are computed the same way
 * `cureDueState` computes them, including the `e.time <= now` bound that keeps a
 * dose stamped in the future from counting as already given.
 *
 * Every cure passed in gets an entry, including one with no doses on record, so
 * a caller can tell "no doses" apart from "cure not considered". Scope `entries`
 * to the child first.
 */
export function cureDoseScalars(
  cures: Cure[],
  entries: Entry[],
  now: number,
): Record<string, { today: number; lastAt: number | null }> {
  const todayMidnight = startOfDay(now);
  const out: Record<string, { today: number; lastAt: number | null }> = {};
  for (const cure of cures) {
    const doses = dosesForCure(entries, cure);
    out[cure.id] = {
      today: doses.filter((e) => e.time >= todayMidnight && e.time <= now).length,
      lastAt: doses.reduce<number | null>(
        (max, e) => (e.time <= now && (max == null || e.time > max) ? e.time : max),
        null,
      ),
    };
  }
  return out;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/store/selectors.test.ts`
Expected: PASS.

- [ ] **Step 5: Extend the notification input types**

In `src/notifications/scheduled.ts`, add to `ReminderPrefs` after `napSuggestions: boolean;` (line 56):

```ts
  treatmentReminders: boolean;
  /** when the treatments toggle was last switched on, epoch ms */
  treatmentRemindersEnabledAt: number | null;
```

Add to `ScheduleInput` after `selectedChildId: string;` (line 83):

```ts
  /** Every cure the store holds. `cureReminders` scopes to `selectedChildId`
   *  itself, the same way `napReminders` does and for the same reason: in server
   *  mode `s.entries` only ever holds the child the last fetch loaded, so dose
   *  history for any other child is unreliable. */
  cures: Cure[];
  /** Per cure id: doses logged since local midnight, and the most recent dose
   *  instant. Derived scalars rather than raw entries, matching `lastPumpAt` and
   *  `lastSleepEndByChild`, so this file stays ignorant of `Entry`. Built by
   *  `cureDoseScalars`, which owns the by-name dose attribution rule. */
  cureDoses: Record<string, { today: number; lastAt: number | null }>;
```

Add `Cure` to the type import on line 16:

```ts
import type { ActivityType, Child, Cure, Timer } from '@/types/models';
```

- [ ] **Step 6: Fix the existing test factories**

`tsc` now fails on `src/notifications/scheduled.test.ts`, because its `prefs()` and `input()` factories no longer satisfy the widened types. Add to the `prefs` factory (after `napSuggestions: false,`, line 28):

```ts
  treatmentReminders: false,
  treatmentRemindersEnabledAt: null,
```

Defaulting to `false` here, opposite to the store default, keeps every existing test's expectations unchanged: the cure tests in Tasks 3 and 4 opt in explicitly, exactly as the pumping and nap tests already do.

Add to the `input` factory (after `selectedChildId: 'c1',`, line 48):

```ts
  cures: [],
  cureDoses: {},
```

- [ ] **Step 7: Write the failing tests for the projection and the gate**

Append to `src/notifications/scheduleSync.test.ts`. Follow that file's existing idiom: `setup()`, `flush()`, and reading `desired.mock.calls.at(-1)![0]`. Add a type-only import at the top of the file:

```ts
import type { Cure, Entry } from '@/types/models';
```

A type-only import is important here: this file mocks modules and calls `vi.resetModules()` per `setup()`, so a value import of the store or its data modules outside `setup()` would defeat that.

```ts
describe('cure projection', () => {
  const cureRec: Cure = {
    id: 'cure1',
    childId: 'c1',
    name: 'Omeprazol',
    scheduleMode: 'timesOfDay',
    timesOfDay: ['morning'],
    fromDate: new Date(2020, 0, 1).getTime(),
    active: true,
  };

  const dose = (childId: string, time: number): Entry => ({
    id: `m-${time}`,
    childId,
    type: 'medication',
    name: 'Omeprazol',
    time,
    // `tags` is required on EntryBase; omitting it is a type error, not an
    // inferred default.
    tags: [],
  });

  it('projects cures and per-cure dose scalars', async () => {
    const { desired, useAppStore } = await setup();
    const doseAt = Date.now() - 60_000;
    useAppStore.setState({ selectedChildId: 'c1', cures: [cureRec], entries: [dose('c1', doseAt)] });
    await flush();

    const input = desired.mock.calls.at(-1)![0];
    expect(input.cures).toEqual([cureRec]);
    expect(input.cureDoses.cure1.lastAt).toBe(doseAt);
  });

  it('scopes dose scalars to the selected child', async () => {
    const { desired, useAppStore } = await setup();
    useAppStore.setState({
      selectedChildId: 'c1',
      cures: [cureRec],
      entries: [dose('c2', Date.now() - 60_000)],
    });
    await flush();

    // The dose belongs to another child, so it must not count toward c1's cure.
    expect(desired.mock.calls.at(-1)![0].cureDoses.cure1).toEqual({ today: 0, lastAt: null });
  });

  it('rebuilds when the cures list changes', async () => {
    const { desired, useAppStore } = await setup();
    const builds = desired.mock.calls.length;
    useAppStore.setState({ cures: [cureRec] });
    await flush();
    expect(desired.mock.calls.length).toBeGreaterThan(builds);
  });

  it('rebuilds when the treatments pref is toggled', async () => {
    const { desired, useAppStore } = await setup();
    const builds = desired.mock.calls.length;
    useAppStore.setState({ treatmentReminders: false });
    await flush();
    expect(desired.mock.calls.length).toBeGreaterThan(builds);
  });

  it('rebuilds when the treatments resync stamp moves', async () => {
    const { desired, useAppStore } = await setup();
    const builds = desired.mock.calls.length;
    useAppStore.setState({ treatmentRemindersEnabledAt: Date.now() });
    await flush();
    expect(desired.mock.calls.length).toBeGreaterThan(builds);
  });
});
```

- [ ] **Step 8: Run them to verify they fail**

Run: `npx vitest run src/notifications/scheduleSync.test.ts`
Expected: FAIL. The projection tests fail on `input.cures` being `undefined`; the three gate tests fail because the build count does not increase.

- [ ] **Step 9: Implement the projection and the gate**

In `src/notifications/scheduleSync.ts`:

Add to the imports:

```ts
import { cureDoseScalars, entriesForChild } from '@/store/selectors';
```

Change `toInput` to take `now`, because the dose scalars need the same instant `desiredScheduled` is given. Its signature line becomes:

```ts
function toInput(s: State, now: number): ScheduleInput {
```

Add to `toInput`'s returned object, after `selectedChildId: s.selectedChildId,` (line 66):

```ts
    cures: s.cures,
    // Scoped to the selected child on both sides, for the reason in the comment
    // above this function: in server mode `s.entries` only ever holds one child,
    // so counting doses for anyone else would silently read another child's
    // history as empty.
    cureDoses: cureDoseScalars(
      s.cures.filter((c) => c.childId === s.selectedChildId),
      entriesForChild(s.entries, s.selectedChildId),
      now,
    ),
```

Add the two new prefs to the `prefs` object in `toInput`, after `napSuggestions: s.napSuggestions,` (line 61):

```ts
      treatmentReminders: s.treatmentReminders,
      treatmentRemindersEnabledAt: s.treatmentRemindersEnabledAt,
```

In `run` (line 97), replace:

```ts
  const desired = desiredScheduled(toInput(s), Date.now());
```

with:

```ts
  // One `now` for both, so the dose scalars and the schedule cannot straddle a
  // local midnight and disagree about what "today" means.
  const now = Date.now();
  const desired = desiredScheduled(toInput(s, now), now);
```

In the change gate (line 167), add before `state.selectedChildId === previous.selectedChildId`:

```ts
      state.cures === previous.cures &&
      state.treatmentReminders === previous.treatmentReminders &&
      state.treatmentRemindersEnabledAt === previous.treatmentRemindersEnabledAt &&
```

`state.entries` and `state.selectedChildId` are already in the gate, so a logged dose and a child switch both already trigger a rebuild.

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npx vitest run src/notifications/scheduleSync.test.ts src/store/selectors.test.ts src/notifications/scheduled.test.ts`
Expected: PASS.

- [ ] **Step 11: Full verification**

Run: `npx tsc --noEmit && npx vitest run && npx expo lint`
Expected: clean.

- [ ] **Step 12: Commit**

```bash
git add src/store/selectors.ts src/store/selectors.test.ts src/notifications/scheduled.ts src/notifications/scheduled.test.ts src/notifications/scheduleSync.ts src/notifications/scheduleSync.test.ts
git commit -m "feat(notifications): project cures and per-cure dose scalars into the reminder input"
```

---

### Task 3: `cureReminders`, fixed times of day

The first half of the builder: a cure whose `scheduleMode` is `'timesOfDay'`. Walks forward day by day from today, emitting one notification per chosen slot at its mapped wall-clock hour, suppressing today's already-settled slots by count.

**Files:**
- Modify: `src/features/cures/cureLabels.ts:16` (export `TIME_OF_DAY_ORDER`)
- Modify: `src/notifications/scheduled.ts:28` (`ReminderKind`), and append the builder before `desiredScheduled` (before line 408); wire it into `desiredScheduled`
- Test: `src/notifications/scheduled.test.ts`

**Interfaces:**
- Consumes: `ScheduleInput.cures`, `ScheduleInput.cureDoses`, `ReminderPrefs.treatmentReminders` (Task 2); `timeOfDaySlotMs`, `isCureActiveToday`, `startOfDay` from `@/store/selectors`; `cureDosageLabel`, `TIME_OF_DAY_ORDER` from `@/features/cures/cureLabels`.
- Produces:
  - `export const CURE_AHEAD = 8`
  - `export const CURE_MAX_DAYS = 14`
  - `ReminderKind` gains `'cure'`
  - a module-private `cureNote(cure: Cure, fireAt: number): ScheduledNotification`
  - a module-private `cureReminders(input: ScheduleInput, now: number): ScheduledNotification[]`, called from `desiredScheduled`

- [ ] **Step 1: Write the failing tests**

Append to `src/notifications/scheduled.test.ts`. Add `CURE_AHEAD` and `CURE_MAX_DAYS` to the import from `@/notifications/scheduled`, and `Cure` to the type import from `@/types/models`.

```ts
describe('desiredScheduled: treatments, fixed times of day', () => {
  const only = (over: Partial<ReminderPrefs>) =>
    prefs({
      dueDateReminders: false,
      staleTimerReminders: false,
      ageMilestones: false,
      treatmentReminders: true,
      ...over,
    });

  const cure = (over: Partial<Cure> = {}): Cure => ({
    id: 'cure1',
    childId: 'c1',
    name: 'Omeprazol',
    scheduleMode: 'timesOfDay',
    timesOfDay: ['morning', 'evening'],
    fromDate: at(2026, 9, 1),
    active: true,
    ...over,
  });

  const run = (over: Partial<ScheduleInput>, now: number) =>
    desiredScheduled(input({ prefs: only({}), selectedChildId: 'c1', ...over }), now);

  it('schedules each chosen slot at its mapped wall-clock hour', () => {
    const out = run({ cures: [cure()] }, at(2026, 9, 2, 6));
    expect(out[0].fireAt).toBe(at(2026, 9, 2, 8));
    expect(out[1].fireAt).toBe(at(2026, 9, 2, 18));
    expect(out[2].fireAt).toBe(at(2026, 9, 3, 8));
  });

  it('names the treatment and carries its dosage and cure-seeded tap target', () => {
    const out = run({ cures: [cure({ dosage: 5, dosageUnit: 'mg' })] }, at(2026, 9, 2, 6));
    expect(out[0].kind).toBe('cure');
    expect(out[0].title).toBe('Omeprazol due');
    expect(out[0].body).toBe('5 mg');
    expect(out[0].data.url).toBe('/log/medication?cure=cure1');
    expect(out[0].identifier).toBe(`${REMINDER_PREFIX}cure:cure1:${at(2026, 9, 2, 8)}`);
  });

  it('falls back to an instruction when the cure records no dosage', () => {
    const out = run({ cures: [cure()] }, at(2026, 9, 2, 6));
    expect(out[0].body).toBe('Tap to log the dose.');
  });

  it('emits slots in chronological order regardless of the order they were picked', () => {
    const out = run({ cures: [cure({ timesOfDay: ['night', 'morning', 'noon'] })] }, at(2026, 9, 2, 6));
    expect(out[0].fireAt).toBe(at(2026, 9, 2, 8));
    expect(out[1].fireAt).toBe(at(2026, 9, 2, 12));
    expect(out[2].fireAt).toBe(at(2026, 9, 2, 22));
  });

  it('keeps every occurrence on its mapped hour across an autumn-back boundary', () => {
    // Built and asserted with calendar arithmetic on each day's own midnight,
    // never by adding 86_400_000: a fixed millisecond day drifts by an hour
    // across a DST change and would move the 08:00 dose to 07:00 or 09:00 for
    // half the year. In a timezone without DST this is a tautology; in one with
    // it, it is the whole point. The eight-day run from 24 October crosses the
    // European clock change on the 25th.
    const out = run({ cures: [cure({ timesOfDay: ['morning'], fromDate: at(2026, 10, 20) })] }, at(2026, 10, 24, 6));
    expect(out).toHaveLength(CURE_AHEAD);
    expect(out.every((n) => new Date(n.fireAt).getHours() === 8)).toBe(true);
    expect(out[0].fireAt).toBe(at(2026, 10, 24, 8));
    expect(out[4].fireAt).toBe(at(2026, 10, 28, 8));
  });

  it('keeps every occurrence on its mapped hour across a spring-forward boundary', () => {
    // The other direction, which fails differently: a millisecond day walk
    // lands at 09:00 here rather than 07:00. The eight-day run from 27 March
    // crosses the European clock change on the 29th.
    const out = run({ cures: [cure({ timesOfDay: ['morning'], fromDate: at(2026, 3, 20) })] }, at(2026, 3, 27, 6));
    expect(out).toHaveLength(CURE_AHEAD);
    expect(out.every((n) => new Date(n.fireAt).getHours() === 8)).toBe(true);
    expect(out[0].fireAt).toBe(at(2026, 3, 27, 8));
    expect(out[4].fireAt).toBe(at(2026, 3, 31, 8));
  });

  it("suppresses today's kth slot once k doses are logged today", () => {
    // One dose given on a morning+evening cure. Counting, not slot matching:
    // the dose settles the FIRST slot and leaves the second owed, so exactly
    // one of today's two slots survives.
    const out = run(
      { cures: [cure()], cureDoses: { cure1: { today: 1, lastAt: at(2026, 9, 2, 7) } } },
      at(2026, 9, 2, 6),
    );
    const today = out.filter((n) => n.fireAt < at(2026, 9, 3));
    expect(today).toHaveLength(1);
    expect(today[0].fireAt).toBe(at(2026, 9, 2, 18));
  });

  it('counts k from the start of the day, not from now', () => {
    // Morning and noon have already passed and two doses were logged, so the
    // evening slot is k = 3 and survives. Numbering the remaining slots from
    // now would make evening k = 1, see dosesToday >= 1, and wrongly drop it.
    const out = run(
      {
        cures: [cure({ timesOfDay: ['morning', 'noon', 'evening'] })],
        cureDoses: { cure1: { today: 2, lastAt: at(2026, 9, 2, 12) } },
      },
      at(2026, 9, 2, 14),
    );
    expect(out[0].fireAt).toBe(at(2026, 9, 2, 18));
  });

  it('suppresses nothing on future days, whatever today looked like', () => {
    const out = run(
      { cures: [cure()], cureDoses: { cure1: { today: 2, lastAt: at(2026, 9, 2, 18) } } },
      at(2026, 9, 2, 20),
    );
    expect(out[0].fireAt).toBe(at(2026, 9, 3, 8));
    expect(out[1].fireAt).toBe(at(2026, 9, 3, 18));
  });

  it('caps output at CURE_AHEAD occurrences per cure', () => {
    const out = run({ cures: [cure()] }, at(2026, 9, 2, 6));
    expect(out).toHaveLength(CURE_AHEAD);
  });

  it('emits one notification per treatment when two are due at the same slot', () => {
    const out = run(
      {
        cures: [
          cure({ timesOfDay: ['morning'] }),
          cure({ id: 'cure2', name: 'Amoxicilline', timesOfDay: ['morning'] }),
        ],
      },
      at(2026, 9, 2, 6),
    );
    const first = out.filter((n) => n.fireAt === at(2026, 9, 2, 8));
    expect(first.map((n) => n.title).sort()).toEqual(['Amoxicilline due', 'Omeprazol due']);
  });

  it('stops at toDate rather than scheduling past the end of the regimen', () => {
    const out = run({ cures: [cure({ toDate: at(2026, 9, 3) })] }, at(2026, 9, 2, 6));
    // toDate is inclusive, so 3 September's slots are the last ones.
    expect(out.every((n) => n.fireAt < at(2026, 9, 4))).toBe(true);
    expect(out.map((n) => n.fireAt)).toContain(at(2026, 9, 3, 18));
  });

  it('terminates on a cure with no times of day chosen', () => {
    expect(run({ cures: [cure({ timesOfDay: [] })] }, at(2026, 9, 2, 6))).toEqual([]);
    expect(run({ cures: [cure({ timesOfDay: undefined })] }, at(2026, 9, 2, 6))).toEqual([]);
  });

  it('schedules nothing for a paused cure', () => {
    expect(run({ cures: [cure({ active: false })] }, at(2026, 9, 2, 6))).toEqual([]);
  });

  it('schedules nothing before fromDate or after toDate', () => {
    expect(run({ cures: [cure({ fromDate: at(2026, 9, 10) })] }, at(2026, 9, 2, 6))).toEqual([]);
    expect(run({ cures: [cure({ toDate: at(2026, 9, 1) })] }, at(2026, 9, 2, 6))).toEqual([]);
  });

  it('schedules nothing for a cure belonging to another child', () => {
    expect(run({ cures: [cure({ childId: 'c2' })] }, at(2026, 9, 2, 6))).toEqual([]);
  });

  it('schedules nothing for a cure whose name is blank', () => {
    // `logMedicationFromCure` refuses a blank name, so such a notification would
    // dead-tap. It would also read as " due".
    expect(run({ cures: [cure({ name: '   ' })] }, at(2026, 9, 2, 6))).toEqual([]);
  });

  it('schedules nothing while the pref is off', () => {
    const out = desiredScheduled(
      input({ prefs: only({ treatmentReminders: false }), cures: [cure()], selectedChildId: 'c1' }),
      at(2026, 9, 2, 6),
    );
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/notifications/scheduled.test.ts`
Expected: FAIL, starting with a TS error that `CURE_AHEAD` is not exported, then empty-array assertions once it is.

- [ ] **Step 3: Export the slot order**

In `src/features/cures/cureLabels.ts`, change line 16 from `const TIME_OF_DAY_ORDER` to:

```ts
export const TIME_OF_DAY_ORDER: CureTimeOfDay[] = ['morning', 'noon', 'evening', 'night'];
```

and extend its doc comment above to:

```ts
/** Fixed order the four times of day read in, regardless of pick order. Also the
 *  chronological order their slots fire in, which is why `cureReminders` in
 *  src/notifications/scheduled.ts reuses this rather than keeping its own copy. */
```

- [ ] **Step 4: Implement the builder**

In `src/notifications/scheduled.ts`:

Extend `ReminderKind` (line 28):

```ts
export type ReminderKind = 'due' | 'stale' | 'age' | 'pump' | 'nap' | 'cure';
```

Add to the imports:

```ts
import { cureDosageLabel, TIME_OF_DAY_ORDER } from '@/features/cures/cureLabels';
import { isCureActiveToday, startOfDay, timeOfDaySlotMs } from '@/store/selectors';
```

`selectors.ts` is pure and node-safe (it imports only `@/lib/timeParse` and types), so this adds no store dependency, only shared pure helpers. Reusing them is deliberate: `isCureActiveToday` already owns the active/child/date-range rule, and `timeOfDaySlotMs` already owns the DST-safe slot construction.

Insert before `desiredScheduled` (before line 408):

```ts
/**
 * How many occurrences to schedule ahead PER CURE, in both schedule modes. Same
 * reasoning as PUMP_AHEAD: a repeating reminder built from one-shot triggers
 * needs the app to reschedule after each fire, and this margin keeps the chain
 * alive between foregrounds.
 *
 * A per-cure occurrence count rather than a fixed number of days, which gives
 * sparse schedules more lookahead for free: a once-a-day cure reaches eight days
 * ahead, a four-slot cure reaches two. It also bounds the total: a parent with
 * several treatments cannot flood the OS queue.
 */
export const CURE_AHEAD = 8;

/** Hard bound on the times-of-day day walk. Only load-bearing for a cure whose
 *  `timesOfDay` is empty, which accumulates no occurrences and would otherwise
 *  never reach CURE_AHEAD. With at least one slot chosen the walk finishes
 *  inside nine days. */
export const CURE_MAX_DAYS = 14;

function cureNote(cure: Cure, fireAt: number): ScheduledNotification {
  const dosage = cureDosageLabel(cure);
  return {
    // Keyed on the id, not the name: the id survives a rename and a rename must
    // not orphan pending alerts. The name still reaches the diff through the
    // title, and `diffScheduled` compares titles, so renaming a treatment
    // reschedules its alerts with the new copy.
    //
    // `fireAt` is in the identifier for the same reason it is in the pumping
    // one. Changing `everyHours`, or re-anchoring the grid, recomputes fireAt
    // for the same cure; without it here the diff would see no change and
    // Android's already-pending alarm would stay at the old spacing (commit
    // bf7c0a5 was exactly this bug for pumping). It stays stable while `now`
    // advances, because fireAt derives from the anchor and the interval.
    identifier: `${REMINDER_PREFIX}cure:${cure.id}:${fireAt}`,
    kind: 'cure',
    title: `${cure.name.trim()} due`,
    // The dosage is the single most useful thing this can carry: it puts "5 mg"
    // on the lock screen without the parent opening the app. With no dosage
    // recorded there is nothing to say, so fall back to the instruction.
    body: dosage || 'Tap to log the dose.',
    fireAt,
    // Lands on the existing medication deep link with the cure named, which
    // seeds the confirm sheet from it. See src/lib/logDeepLink.ts. The tap
    // opens, it never writes, so "tap to log the dose" stays literally true.
    data: { url: `/log/medication?cure=${encodeURIComponent(cure.id)}` },
  };
}

/**
 * Fixed times of day: each chosen slot fires at its mapped wall-clock hour.
 *
 * Walks forward day by day, stopping at CURE_AHEAD occurrences, CURE_MAX_DAYS
 * days, or the cure's toDate, whichever comes first. Each instant is built off
 * THAT day's own midnight with setHours (via `timeOfDaySlotMs`), never as
 * midnight plus n * 86_400_000, so a DST boundary cannot move the 08:00 dose to
 * 07:00 or 09:00 for half the year.
 */
function cureTimesOfDayReminders(
  cure: Cure,
  input: ScheduleInput,
  now: number,
  todayMidnight: number,
): ScheduledNotification[] {
  const slots = TIME_OF_DAY_ORDER.filter((tod) => cure.timesOfDay?.includes(tod));
  const dosesToday = input.cureDoses[cure.id]?.today ?? 0;
  const out: ScheduledNotification[] = [];
  for (let day = 0; day < CURE_MAX_DAYS && out.length < CURE_AHEAD; day++) {
    const dayMidnight = addDays(todayMidnight, day);
    // toDate is stored at local midnight and is inclusive, so the regimen covers
    // the whole of that day.
    if (cure.toDate != null && dayMidnight > cure.toDate) break;
    for (let k = 0; k < slots.length && out.length < CURE_AHEAD; k++) {
      // TODAY ONLY: the kth slot (1-based, counted from the start of the day
      // rather than from now) is settled once k doses are logged today. This is
      // `cureDueState`'s counting rule expressed forward. Counting rather than
      // matching slot to dose is what makes a late dose behave: on a
      // morning+evening cure one dose given at 19:00 settles the earlier owed
      // slot and leaves the later one owed, where a per-slot "any dose after
      // this slot clears it" rule would let that single dose clear both.
      // Future days are unaffected: their doses-today is zero by definition.
      if (day === 0 && dosesToday >= k + 1) continue;
      const fireAt = timeOfDaySlotMs(dayMidnight, slots[k]);
      if (fireAt <= now) continue;
      out.push(cureNote(cure, fireAt));
    }
  }
  return out;
}

/**
 * Reminders for the treatments a parent authored. Unlike the other five kinds,
 * which are derived from facts the app works out for itself, this one only ever
 * reports back a schedule the user typed in. That is why it ships on.
 */
function cureReminders(input: ScheduleInput, now: number): ScheduledNotification[] {
  const todayMidnight = startOfDay(now);
  const out: ScheduledNotification[] = [];
  for (const cure of input.cures) {
    // Scoped to the selected child, and forced rather than chosen: in server
    // mode `s.entries` only ever holds the child the last fetch loaded, so dose
    // history for anyone else is unreliable. `napReminders` gates on the same
    // constraint for the same reason. `isCureActiveToday` also covers the
    // paused flag and the fromDate/toDate range.
    if (!isCureActiveToday(cure, todayMidnight, input.selectedChildId)) continue;
    // A cure always carries a name (the editor requires one), but gate on it the
    // same way `logMedicationFromCure` does: an alert titled " due" whose tap
    // that action then refuses would be a dead tap.
    if (!cure.name.trim()) continue;
    out.push(...cureTimesOfDayReminders(cure, input, now, todayMidnight));
  }
  return out;
}
```

Note that `cureReminders` dispatches only on the times-of-day path for now. Task 4 adds the `everyHours` branch.

Wire it into `desiredScheduled`, after the `napSuggestions` block (line 424):

```ts
  if (input.prefs.treatmentReminders) {
    out.push(...cureReminders(input, now));
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/notifications/scheduled.test.ts`
Expected: PASS.

If `emits slots in chronological order` fails, the cause is `TIME_OF_DAY_ORDER` not being used to sort. If the DST test fails, the cause is millisecond day arithmetic somewhere instead of `addDays` plus `timeOfDaySlotMs`.

- [ ] **Step 6: Full verification**

Run: `npx tsc --noEmit && npx vitest run && npx expo lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/features/cures/cureLabels.ts src/notifications/scheduled.ts src/notifications/scheduled.test.ts
git commit -m "feat(notifications): remind on a treatment's fixed times of day"
```

---

### Task 4: `cureReminders`, every N hours

The second half of the builder: an interval grid anchored to the last logged dose, structurally identical to `pumpReminders`, plus the resync lever with its load-bearing ordering guard.

**Files:**
- Modify: `src/notifications/scheduled.ts` (add `cureEveryHoursReminders`, dispatch from `cureReminders`)
- Test: `src/notifications/scheduled.test.ts`

**Interfaces:**
- Consumes: `CURE_AHEAD`, `cureNote`, `cureReminders` (Task 3); `ReminderPrefs.treatmentRemindersEnabledAt` (Task 2).
- Produces: a module-private `cureEveryHoursReminders(cure: Cure, input: ScheduleInput, now: number): ScheduledNotification[]`. No new exports.

- [ ] **Step 1: Write the failing tests**

Append to `src/notifications/scheduled.test.ts`.

```ts
describe('desiredScheduled: treatments, every N hours', () => {
  const only = (over: Partial<ReminderPrefs> = {}) =>
    prefs({
      dueDateReminders: false,
      staleTimerReminders: false,
      ageMilestones: false,
      treatmentReminders: true,
      ...over,
    });

  const cure = (over: Partial<Cure> = {}): Cure => ({
    id: 'cure1',
    childId: 'c1',
    name: 'Amoxicilline',
    scheduleMode: 'everyHours',
    everyHours: 8,
    fromDate: at(2026, 9, 1),
    active: true,
    ...over,
  });

  const run = (over: Partial<ScheduleInput>, now: number, p: Partial<ReminderPrefs> = {}) =>
    desiredScheduled(input({ prefs: only(p), selectedChildId: 'c1', ...over }), now);

  it('anchors the grid on the last logged dose', () => {
    const out = run(
      { cures: [cure()], cureDoses: { cure1: { today: 1, lastAt: at(2026, 9, 2, 6) } } },
      at(2026, 9, 2, 7),
    );
    expect(out).toHaveLength(CURE_AHEAD);
    expect(out[0].fireAt).toBe(at(2026, 9, 2, 14));
    expect(out[1].fireAt).toBe(at(2026, 9, 2, 22));
    expect(out[0].title).toBe('Amoxicilline due');
  });

  it('re-anchors when a newer dose is logged', () => {
    const a = run(
      { cures: [cure()], cureDoses: { cure1: { today: 1, lastAt: at(2026, 9, 2, 6) } } },
      at(2026, 9, 2, 7),
    );
    const b = run(
      { cures: [cure()], cureDoses: { cure1: { today: 2, lastAt: at(2026, 9, 2, 7) } } },
      at(2026, 9, 2, 7),
    );
    expect(b[0].fireAt).toBe(at(2026, 9, 2, 15));
    expect(a[0].identifier).not.toBe(b[0].identifier);
  });

  it('re-enters the grid on phase when every occurrence has already passed', () => {
    // Dosed two days ago, app never opened since. Scheduling blindly from the
    // anchor would produce only past instants and therefore nothing at all.
    const out = run(
      { cures: [cure()], cureDoses: { cure1: { today: 0, lastAt: at(2026, 9, 1, 6) } } },
      at(2026, 9, 3, 7),
    );
    expect(out).toHaveLength(CURE_AHEAD);
    expect(out.every((n) => n.fireAt > at(2026, 9, 3, 7))).toBe(true);
    expect(out[0].fireAt).toBe(at(2026, 9, 3, 14));
  });

  it('schedules nothing for an interval cure that has never been dosed', () => {
    // "Every 8 hours" means eight hours after the last dose. With no last dose
    // there is no defined next instant, and any anchor invented for one is a
    // guess. The in-app tile still shows it as due, so nobody is left unaware.
    expect(run({ cures: [cure()], cureDoses: { cure1: { today: 0, lastAt: null } } }, at(2026, 9, 2, 7))).toEqual([]);
    expect(run({ cures: [cure()], cureDoses: {} }, at(2026, 9, 2, 7))).toEqual([]);
  });

  it('schedules nothing for an interval cure with no interval set', () => {
    expect(
      run(
        { cures: [cure({ everyHours: undefined })], cureDoses: { cure1: { today: 1, lastAt: at(2026, 9, 2, 6) } } },
        at(2026, 9, 2, 7),
      ),
    ).toEqual([]);
  });

  it('moves an existing grid forward when the resync stamp is later than the last dose', () => {
    const out = run(
      { cures: [cure()], cureDoses: { cure1: { today: 1, lastAt: at(2026, 9, 2, 6) } } },
      at(2026, 9, 2, 11),
      { treatmentRemindersEnabledAt: at(2026, 9, 2, 10) },
    );
    expect(out[0].fireAt).toBe(at(2026, 9, 2, 18));
  });

  it('ignores a resync stamp older than the last dose', () => {
    const out = run(
      { cures: [cure()], cureDoses: { cure1: { today: 1, lastAt: at(2026, 9, 2, 6) } } },
      at(2026, 9, 2, 7),
      { treatmentRemindersEnabledAt: at(2026, 9, 1, 10) },
    );
    expect(out[0].fireAt).toBe(at(2026, 9, 2, 14));
  });

  it('still schedules nothing when the resync stamp is set but no dose was ever logged', () => {
    // The ordering guard. A plain Math.max(lastAt ?? 0, enabledAt ?? 0), which
    // is what pumpReminders does, would manufacture a grid here out of a time
    // the app invented. The stamp may only ever MOVE an existing grid.
    expect(
      run({ cures: [cure()], cureDoses: { cure1: { today: 0, lastAt: null } } }, at(2026, 9, 2, 11), {
        treatmentRemindersEnabledAt: at(2026, 9, 2, 10),
      }),
    ).toEqual([]);
  });

  it('does not let the resync stamp shift a times-of-day cure', () => {
    // Those instants come off the wall clock, not off a phase, so there is
    // nothing for a rebase to move. Toggling off and on cannot move an 08:00
    // dose, and should not.
    const todCure: Cure = {
      id: 'cure2',
      childId: 'c1',
      name: 'Omeprazol',
      scheduleMode: 'timesOfDay',
      timesOfDay: ['morning'],
      fromDate: at(2026, 9, 1),
      active: true,
    };
    const out = run({ cures: [todCure] }, at(2026, 9, 2, 6), {
      treatmentRemindersEnabledAt: at(2026, 9, 2, 5),
    });
    expect(out[0].fireAt).toBe(at(2026, 9, 2, 8));
  });

  it('keeps the identifier stable as now advances within the same occurrence', () => {
    const doses = { cure1: { today: 1, lastAt: at(2026, 9, 2, 6) } };
    const a = run({ cures: [cure()], cureDoses: doses }, at(2026, 9, 2, 7));
    const b = run({ cures: [cure()], cureDoses: doses }, at(2026, 9, 2, 8));
    expect(a[0].identifier).toBe(b[0].identifier);
  });

  it('changes the identifier when the interval changes', () => {
    const doses = { cure1: { today: 1, lastAt: at(2026, 9, 2, 6) } };
    const a = run({ cures: [cure({ everyHours: 8 })], cureDoses: doses }, at(2026, 9, 2, 7));
    const b = run({ cures: [cure({ everyHours: 6 })], cureDoses: doses }, at(2026, 9, 2, 7));
    expect(a[0].identifier).not.toBe(b[0].identifier);
  });

  it('stops at the end of the day toDate names', () => {
    const out = run(
      { cures: [cure({ toDate: at(2026, 9, 2) })], cureDoses: { cure1: { today: 1, lastAt: at(2026, 9, 2, 6) } } },
      at(2026, 9, 2, 7),
    );
    // 14:00 and 22:00 fall inside the last day; 06:00 the next morning does not.
    expect(out.map((n) => n.fireAt)).toEqual([at(2026, 9, 2, 14), at(2026, 9, 2, 22)]);
  });

  it('schedules nothing for a paused interval cure', () => {
    expect(
      run(
        { cures: [cure({ active: false })], cureDoses: { cure1: { today: 1, lastAt: at(2026, 9, 2, 6) } } },
        at(2026, 9, 2, 7),
      ),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/notifications/scheduled.test.ts`
Expected: FAIL. Every positive assertion fails with an empty array, because `cureReminders` currently sends an `everyHours` cure down the times-of-day path, which finds no slots.

Five of them pass already: the four "schedules nothing" tests, and `does not let the resync stamp shift a times-of-day cure` (which exercises the Task 3 path). That is expected. Keep them; they lock the behaviour in once the branch exists, and the four negative ones are exactly the cases a careless `Math.max` would break.

- [ ] **Step 3: Implement the interval branch**

In `src/notifications/scheduled.ts`, insert directly after `cureTimesOfDayReminders`:

```ts
/**
 * Every N hours: a grid of occurrences anchored to the last logged dose,
 * structurally identical to `pumpReminders`.
 *
 * The grid re-anchors on every logged dose, because logging writes the store and
 * the write triggers a reconcile, so the normal way to correct a drifting
 * reminder is simply to log the dose, including after the fact with its real
 * time. `treatmentRemindersEnabledAt` covers the one gap that leaves: a dose
 * given but never logged. See setReminderPref in useAppStore.ts.
 */
function cureEveryHoursReminders(
  cure: Cure,
  input: ScheduleInput,
  now: number,
): ScheduledNotification[] {
  // An interval with no hours set has no schedule to be late against.
  if (cure.everyHours == null || cure.everyHours <= 0) return [];

  const lastDoseAt = input.cureDoses[cure.id]?.lastAt ?? null;
  // THE ORDER OF THE NEXT TWO STATEMENTS IS LOAD-BEARING. The null check must
  // come first. A plain Math.max(lastDoseAt ?? 0, enabledAt ?? 0), which is what
  // pumpReminders does, would manufacture a grid for a cure that has never been
  // dosed. "Every 8 hours" means eight hours after the last dose; with no last
  // dose there is no defined next instant, and any anchor invented for one is a
  // guess the parent never made. The resync stamp may only ever MOVE an existing
  // grid forward, never bring one into being.
  //
  // The parent is not left unaware: cureDueState returns due: 1 for exactly this
  // case, so the Medication tile still reads "Amoxicilline due" in the app. They
  // simply get no push for a time the app made up. Logging dose one starts the
  // grid.
  if (lastDoseAt == null) return [];
  const anchor = Math.max(lastDoseAt, input.prefs.treatmentRemindersEnabledAt ?? 0);

  const interval = cure.everyHours * 3_600_000;
  // toDate is stored at local midnight and is inclusive, so the regimen runs to
  // the end of that day. addDays keeps this correct across a DST boundary.
  const endsAt = cure.toDate != null ? addDays(cure.toDate, 1) : null;
  // Deriving the first occurrence from `now` rather than blindly from the anchor
  // is what makes the grid self-healing: if every scheduled occurrence has
  // already passed (the app sat closed for a day), it re-enters the grid on
  // phase instead of scheduling nothing.
  const first = Math.max(1, Math.ceil((now - anchor) / interval));
  const out: ScheduledNotification[] = [];
  for (let n = first; out.length < CURE_AHEAD && n < first + CURE_AHEAD + 1; n++) {
    const fireAt = anchor + n * interval;
    if (fireAt <= now) continue;
    if (endsAt != null && fireAt >= endsAt) break;
    out.push(cureNote(cure, fireAt));
  }
  return out;
}
```

Then change the push in `cureReminders` from:

```ts
    out.push(...cureTimesOfDayReminders(cure, input, now, todayMidnight));
```

to:

```ts
    out.push(
      ...(cure.scheduleMode === 'everyHours'
        ? cureEveryHoursReminders(cure, input, now)
        : cureTimesOfDayReminders(cure, input, now, todayMidnight)),
    );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/notifications/scheduled.test.ts`
Expected: PASS, both treatment describe blocks and every pre-existing block.

- [ ] **Step 5: Full verification**

Run: `npx tsc --noEmit && npx vitest run && npx expo lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/notifications/scheduled.ts src/notifications/scheduled.test.ts
git commit -m "feat(notifications): remind on a treatment's hourly interval, anchored to the last dose"
```

---

### Task 5: The Treatments settings row

**Files:**
- Modify: `src/app/settings/notifications.tsx:20-25` (the `ReminderKey` union), `:31-38` (selectors), `:47-78` (the rows array)
- Test: none. This screen has no test harness (vitest runs `.ts` only, `environment: 'node'`), and the row is a data entry in an array the existing `rows.map` already renders. Verification is by reading the diff plus the full suite staying green.

**Interfaces:**
- Consumes: `AppState.treatmentReminders`, `setReminderPref('treatmentReminders', …)` (Task 1).
- Produces: nothing other tasks consume.

- [ ] **Step 1: Extend the key union**

Replace lines 20 to 25 with:

```ts
type ReminderKey =
  | 'dueDateReminders'
  | 'staleTimerReminders'
  | 'ageMilestones'
  | 'napSuggestions'
  | 'pumpingReminders'
  | 'treatmentReminders';
```

- [ ] **Step 2: Select the new pref**

After `const pumpingIntervalMin = useAppStore((s) => s.pumpingIntervalMin);` (line 36):

```ts
  const treatmentReminders = useAppStore((s) => s.treatmentReminders);
```

A plain boolean selector, so zustand's default `Object.is` equality applies and no new reference is created per render.

- [ ] **Step 3: Add the row**

Append to the `rows` array, after the `pumpingReminders` entry (after line 77):

```ts
    {
      key: 'treatmentReminders',
      label: 'Treatments',
      hint: 'When a dose of a treatment is due.',
      on: treatmentReminders,
    },
```

No interval chip row, unlike pumping: the interval already lives on the cure itself and is set in the cure editor.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx vitest run && npx expo lint`
Expected: clean, 1289 plus the new tests all passing.

Then read the rendered result rather than assuming. Follow the recipe in the run-on-web memory: `npm install` first if `expo start` complains about a declared-but-uninstalled `expo-image-picker`, start Expo web with `CI=1`, and open `/settings/notifications` in headless Playwright with `--no-sandbox`. Confirm the Treatments row renders with its label and hint, that the toggle reads on, and that the row separator lines still land correctly now that a sixth row is last. Note that off Android the screen shows the "Android only" card instead of the permission prompt, which is expected.

- [ ] **Step 5: Commit**

```bash
git add src/app/settings/notifications.tsx
git commit -m "feat(settings): add the Treatments reminder toggle"
```

---

### Task 6: Seed the medication sheet from the tapped notification

Makes the tap land one press from done. `logMedicationFromCure` already seeds name, dosage, unit and the next-dose interval and opens the sheet in confirm mode without writing anything, so this task adds no store code: it teaches the deep link to call that action instead of the bare `openSheet('medication')`.

The routing decision moves into a pure `.ts` module because the vitest config is `include: ['src/**/*.test.ts']` with `environment: 'node'` and the repo has no component-test harness at all. This is the same split `scheduled.ts` and `scheduleSync.ts` already use: pure decision, thin caller.

**Deliberate behaviour change to flag in review:** `/log/medication` with NO `cure` parameter currently calls `openSheet('medication')` and lands on the blank manual form. After this task it calls `openMedicationLog()`, which opens the cure picker when the selected child has active cures today and falls through to the same blank form when they do not. The spec calls for this. It makes a medication deep link behave exactly like the in-app Medication tile, and it affects any home-screen widget pointing at `babybuddy://log/medication`.

**Files:**
- Create: `src/lib/logDeepLink.ts`
- Create: `src/lib/logDeepLink.test.ts`
- Modify: `src/app/log/[type].tsx` (whole file)

**Interfaces:**
- Consumes: the `data.url` shape `/log/medication?cure={id}` produced by `cureNote` (Task 3).
- Produces:
  - `export type LogDeepLinkAction = { kind: 'none' } | { kind: 'sheet'; activity: ActivityType } | { kind: 'cure'; cureId: string } | { kind: 'medicationLog' }`
  - `export function resolveLogDeepLink(params: { type: string | undefined; cure: string | undefined; connected: boolean; expected: boolean; cures: Cure[] }): LogDeepLinkAction`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/logDeepLink.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { resolveLogDeepLink } from '@/lib/logDeepLink';
import type { Cure } from '@/types/models';

const cure = (over: Partial<Cure> = {}): Cure => ({
  id: 'cure1',
  childId: 'c1',
  name: 'Omeprazol',
  scheduleMode: 'timesOfDay',
  timesOfDay: ['morning'],
  fromDate: new Date(2026, 8, 1).getTime(),
  active: true,
  ...over,
});

const base = { type: 'feeding', cure: undefined, connected: true, expected: false, cures: [] as Cure[] };

describe('resolveLogDeepLink', () => {
  it('opens the sheet for a plain activity', () => {
    expect(resolveLogDeepLink({ ...base, type: 'feeding' })).toEqual({ kind: 'sheet', activity: 'feeding' });
  });

  it('does nothing when not connected', () => {
    expect(resolveLogDeepLink({ ...base, connected: false })).toEqual({ kind: 'none' });
  });

  it('does nothing when the selected child is still expected', () => {
    // Logging against a due date rather than a birth date. Same guard the route
    // has always had, and the one timer.tsx mirrors.
    expect(resolveLogDeepLink({ ...base, expected: true })).toEqual({ kind: 'none' });
  });

  it('does nothing for an unknown activity', () => {
    expect(resolveLogDeepLink({ ...base, type: 'nonsense' })).toEqual({ kind: 'none' });
    expect(resolveLogDeepLink({ ...base, type: undefined })).toEqual({ kind: 'none' });
  });

  it('seeds the sheet from a cure the parameter names', () => {
    expect(
      resolveLogDeepLink({ ...base, type: 'medication', cure: 'cure1', cures: [cure()] }),
    ).toEqual({ kind: 'cure', cureId: 'cure1' });
  });

  it('opens the medication log when the parameter is absent', () => {
    expect(resolveLogDeepLink({ ...base, type: 'medication', cures: [cure()] })).toEqual({
      kind: 'medicationLog',
    });
  });

  it('falls back when the parameter names a cure that no longer exists', () => {
    // A pending notification outlives the cure it names: it can be deleted
    // between being scheduled and being tapped. logMedicationFromCure refuses an
    // unknown id and would open nothing at all.
    expect(
      resolveLogDeepLink({ ...base, type: 'medication', cure: 'gone', cures: [cure()] }),
    ).toEqual({ kind: 'medicationLog' });
  });

  it('falls back when the named cure has a blank name', () => {
    // logMedicationFromCure refuses this too, for the same reason save() does.
    expect(
      resolveLogDeepLink({ ...base, type: 'medication', cure: 'cure1', cures: [cure({ name: '  ' })] }),
    ).toEqual({ kind: 'medicationLog' });
  });

  it('falls back on a blank or whitespace-only parameter', () => {
    expect(
      resolveLogDeepLink({ ...base, type: 'medication', cure: '   ', cures: [cure()] }),
    ).toEqual({ kind: 'medicationLog' });
  });

  it('ignores a cure parameter on a non-medication activity', () => {
    expect(
      resolveLogDeepLink({ ...base, type: 'sleep', cure: 'cure1', cures: [cure()] }),
    ).toEqual({ kind: 'sheet', activity: 'sleep' });
  });

  it('still refuses everything when not connected, even with a valid cure', () => {
    expect(
      resolveLogDeepLink({ ...base, type: 'medication', cure: 'cure1', cures: [cure()], connected: false }),
    ).toEqual({ kind: 'none' });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/logDeepLink.test.ts`
Expected: FAIL, cannot resolve `@/lib/logDeepLink`.

- [ ] **Step 3: Write the resolver**

Create `src/lib/logDeepLink.ts`:

```ts
/**
 * The routing decision behind `babybuddy://log/<type>`, split out of
 * `app/log/[type].tsx` so it can be unit-tested: vitest runs under node with
 * `include: ['src/**\/*.test.ts']`, so a .tsx route has no test harness. Same
 * split as `scheduled.ts` and `scheduleSync.ts`: pure decision, thin caller.
 */

import { ALL_ACTIVITIES } from '@/lib/activities';
import type { ActivityType, Cure } from '@/types/models';

export type LogDeepLinkAction =
  /** not connected, still expecting, or an activity we do not log */
  | { kind: 'none' }
  /** open the Quick-Log sheet for this activity */
  | { kind: 'sheet'; activity: ActivityType }
  /** seed a medication draft from this cure and open the confirm sheet */
  | { kind: 'cure'; cureId: string }
  /** the cure picker, or the manual form when the child has no active cures */
  | { kind: 'medicationLog' };

export function resolveLogDeepLink(params: {
  type: string | undefined;
  cure: string | undefined;
  connected: boolean;
  expected: boolean;
  cures: Cure[];
}): LogDeepLinkAction {
  // Logging against a child who is still expected would stamp an activity onto
  // a due date rather than a birth date. Same guard timer.tsx mirrors.
  if (!params.connected || params.expected) return { kind: 'none' };
  const activity = params.type as ActivityType;
  if (!ALL_ACTIVITIES.includes(activity)) return { kind: 'none' };
  if (activity !== 'medication') return { kind: 'sheet', activity };

  const id = params.cure?.trim();
  if (!id) return { kind: 'medicationLog' };

  // Resolve the cure HERE rather than handing the id straight to
  // `logMedicationFromCure`: that action returns silently when the id is unknown
  // or the name is blank, which would leave the parent on a dead tap. A pending
  // notification outlives the cure it names, since the cure can be deleted,
  // renamed to blank, or paused in the window between the alert being scheduled
  // and being tapped. Falling back gives them the normal picker instead.
  const cure = params.cures.find((c) => c.id === id);
  if (!cure || !cure.name.trim()) return { kind: 'medicationLog' };
  return { kind: 'cure', cureId: cure.id };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/logDeepLink.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Rewrite the route to use it**

Replace the whole of `src/app/log/[type].tsx` with:

```tsx
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { resolveLogDeepLink } from '@/lib/logDeepLink';
import { useAppStore } from '@/store/useAppStore';

/**
 * Deep-link target: `babybuddy://log/<type>` (a home-screen widget, or a
 * treatment reminder tap). Opens the matching Quick-Log sheet over Home, or
 * routes to onboarding if the app isn't connected yet.
 *
 * `?cure=<id>` seeds the medication sheet from that treatment: name, dosage,
 * unit and next-dose interval filled in, opened in confirm mode, with only the
 * time left to adjust and Log left to press. It writes nothing. A notification
 * tap opens something, it never writes, and `logMedicationFromCure` already
 * holds that line ("No entry is written here; save() commits it once the user
 * confirms").
 *
 * The Quick-Log sheet is a root-level overlay driven by global state, so opening
 * it only needs a store action. Navigation back to the tabs uses a declarative
 * <Redirect> (not an imperative router.replace() in the effect) so it survives a
 * cold start where the navigation container ref isn't live yet, see timer.tsx.
 */
export default function LogDeepLink() {
  const { type, cure } = useLocalSearchParams<{ type: string; cure?: string }>();
  const connected = useAppStore((s) => s.connected);
  const openSheet = useAppStore((s) => s.openSheet);
  const openMedicationLog = useAppStore((s) => s.openMedicationLog);
  const logMedicationFromCure = useAppStore((s) => s.logMedicationFromCure);
  const expected = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId)?.expected ?? false);

  useEffect(() => {
    // `cures` is read imperatively rather than subscribed. The root layout
    // renders null until `hydrating` clears (see _layout.tsx), so cures are
    // already loaded by the time this route mounts, and keeping the array out
    // of the dep list stops a background sync replacing it from re-running this
    // effect, which would reseed the draft and wipe a time the parent had
    // already adjusted.
    const action = resolveLogDeepLink({
      type,
      cure,
      connected,
      expected,
      cures: useAppStore.getState().cures,
    });
    if (action.kind === 'sheet') openSheet(action.activity);
    else if (action.kind === 'cure') logMedicationFromCure(action.cureId);
    else if (action.kind === 'medicationLog') openMedicationLog();
  }, [connected, expected, type, cure, openSheet, openMedicationLog, logMedicationFromCure]);

  if (!connected) return <Redirect href="/onboarding" />;
  // Always lands on Home. When the selected child is expected, the resolver
  // above returns 'none', so this is a plain redirect there instead of over an
  // open sheet.
  return <Redirect href="/(tabs)" />;
}
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npx vitest run && npx expo lint`
Expected: clean.

If `expo lint` flags the `react-hooks/exhaustive-deps` rule over the missing `cures` dependency, do not silence it by adding `cures` to the array, which reintroduces the reseed hazard the comment describes. The `useAppStore.getState()` call inside the effect reads no reactive value, so the rule should not fire; if it does, add a narrowly scoped `eslint-disable-next-line react-hooks/exhaustive-deps` with a one-line reason pointing at the comment above.

- [ ] **Step 7: Check the tap end to end**

This is the one part of the feature that cannot be unit-tested, so exercise it by hand. On web (see the run-on-web memory for the recipe), with a connected profile that has at least one active cure with a dosage:

1. Open `/log/medication?cure=<the cure id>`. The medication sheet must open in confirm mode showing that treatment's name and dosage, with a time picker and a Log button, and no entry written until Log is pressed.
2. Open `/log/medication?cure=doesnotexist`. The cure picker must open (or the blank manual form if the child has no active cures today), not a dead screen.
3. Open `/log/feeding`. Unchanged: the feeding sheet opens.

Report what you saw. Do not claim this passed without running it.

- [ ] **Step 8: Commit**

```bash
git add src/lib/logDeepLink.ts src/lib/logDeepLink.test.ts "src/app/log/[type].tsx"
git commit -m "feat(notifications): seed the medication sheet from a tapped treatment reminder"
```

---

## Final verification

- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` green, with roughly 55 new tests on top of the 1289 baseline
- [ ] `npx expo lint` reports nothing new (confirm any leftover with `git diff --stat main -- <path>`)
- [ ] No em-dashes in anything this plan touched. Check with `grep -rn $'—' src/ docs/superpowers/`, which names the character by codepoint so the command does not match itself.
- [ ] `git status` clean, every task committed

Then use `superpowers:requesting-code-review`, and `superpowers:finishing-a-development-branch` to decide how this and the `scheduled-reminders` branch it sits on get integrated.

## Deliberate omissions

Called out so a reviewer does not read them as oversights. All are recorded as out of scope in the spec:

- No per-cure reminder toggle. The global switch plus the existing per-cure `active` (pause) flag covers it, without adding a field that would have to round-trip through the cure-tagged-note sync encoding.
- No grouping of several due doses into one notification. Naming the drug is the whole value of the alert.
- No follow-up or repeat for a missed dose. A second buzz invites double-dosing, and the app cannot know the dose was not given.
- No quiet hours. A 22:00 `night` slot or a 03:00 interval dose is deliberate, unlike a nap suggestion at night.
- No notification action buttons. That is the one design that would give one-tap timer starts while keeping the body passive, and it is worth revisiting if "open, never write" starts costing too many presses.
- No change to the other five reminders. All already land somewhere that writes nothing, and none has a cheap prefill available.
- Two active cures sharing a name for one child still mute each other. That follows from name attribution and is existing `cureDueState` behaviour, not something this feature introduces.
