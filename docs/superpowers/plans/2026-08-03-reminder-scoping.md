# Reminder Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** treatment reminders and the milestone catch-up nudge cover every child in the household, not only the one the app happens to have selected.

**Architecture:** `scheduleSync.ts` projects the store into a `ScheduleInput`; `scheduled.ts` turns that into the desired notification set and never imports store types. That split stays. Three selected-child call sites in `scheduled.ts` widen to loop over their own children, the two milestone key lists on `ScheduleInput` become per-child maps, the dose scalars are built per child and merged, and `selectedChildId` then has no readers left and is deleted from the input.

**Tech Stack:** TypeScript, React Native / Expo SDK 56, zustand, vitest (node environment).

**Spec:** `docs/superpowers/specs/2026-08-03-reminder-scoping-design.md`. Read it before Task 1.

**Branch:** `feat/reminder-scoping`, already created off `main` at `216b54a` with the spec committed as `9f42577`. Do not create another branch and do not merge to `main`; the user runs releases explicitly.

## Global Constraints

- **No em-dashes anywhere**: prose, code comments, commit messages, UI copy. Use commas, colons, or separate sentences.
- Read the exact versioned Expo docs at https://docs.expo.dev/versions/v56.0.0/ before writing code against an Expo module. No task here touches one, so this should not come up.
- `vitest` runs in the **node** environment and matches `src/**/*.test.ts` only. Everything in this plan is reachable by the suite; no `.tsx` and no native module is involved.
- Never return a new object or array reference from a `useAppStore` selector (zustand v5 infinite loop). Not expected here, but it is a standing rule.
- The suite is `npx vitest run`. Typecheck with `npx tsc --noEmit`, lint with `npx eslint .`, both before every commit.
- **Pre-existing failures you must NOT chase.** In the primary repo (`/home/karlie/Repositories/budkin`) `npx tsc --noEmit` reports 10 errors of the form `Type '"/(tabs)"' is not assignable to ...`, in `src/app/*`, `src/lib/nav.ts`, `src/shell/Sidebar.tsx` and `src/features/setup/useFinishSetup.ts`. They come from a stale generated `.expo/types/router.d.ts`, they predate this branch, and the same checkout run from a git worktree is clean. `npx eslint .` reports about 35 problems, all in `design_handoff_baby_buddy/` plus one unused-import warning in `src/api/client.test.ts`. Leave every one of them alone. What matters is that your change adds no NEW error or warning.
- The middle dot in the treatment title is U+00B7 (`·`), copied from the stale-timer reminder's existing `${child.first} · ${label}`.

---

## File Structure

**No files are created.** Five are modified:

- `src/notifications/scheduleSync.ts`: the projection. `toInput` (lines 30-97) builds the per-child dose scalars and the per-child milestone maps; the subscriber's slice gate (lines 197-222) loses its `selectedChildId` entry.
- `src/notifications/scheduled.ts`: the rules. `ScheduleInput` (lines 68-111), `treatmentNote` (486), `treatmentTimesOfDayReminders` (527), `treatmentEveryHoursReminders` (569), `treatmentReminders` (617), `milestoneReminders` (663), `desiredScheduled`'s catch-up branch (735-744), and one stale comment in `treatmentDoseGiven` (around 808).
- `src/notifications/scheduled.test.ts`: the `input` fixture (line 49) and the treatment and milestone describes.
- `src/notifications/scheduleSync.test.ts`: the dose scalar tests (around 486-505) and the two selection tests (355, 398).
- `src/notifications/applySchedule.android.test.ts`: one `ScheduleInput` fixture (line 81).

`src/notifications/sync.test.ts` and `src/notifications/register.android.test.ts` also mention `selectedChildId`, but both read it from the STORE (timer notifications, and choosing a child on tap). Neither builds a `ScheduleInput`. **Do not touch them.**

---

### Task 1: Dose scalars for every child

`treatmentDoseScalars` attributes a dose to a treatment by trimmed, case-insensitive NAME, so it must never see two children's data at once. Today `scheduleSync` sidesteps that by passing one child's treatments and one child's entries. This task keeps the guarantee while covering everyone: group the treatments by their own `childId`, and call the scalar builder once per group over that child's entries.

Nothing observable changes yet. `treatmentReminders` still filters to the selected child, so the extra scalars are simply unread until Task 3.

**Files:**
- Modify: `src/notifications/scheduleSync.ts` (the `treatmentDoses` construction, lines 77-90), `src/notifications/scheduled.ts` (the `treatmentDoseGiven` doc comment, around lines 806-812)
- Test: `src/notifications/scheduleSync.test.ts`

**Interfaces:**
- Consumes: `treatmentDoseScalars(treatments: Treatment[], entries: Entry[], now: number): Record<string, { today: number; lastAt: number | null }>` and `entriesForChild(entries: Entry[], childId: string | undefined): Entry[]`, both from `@/store/selectors`, both already imported by `scheduleSync.ts`.
- Produces: no signature change. `ScheduleInput.treatmentDoses` keeps its exact type; it simply gains keys for every treatment in the store rather than the selected child's alone.

- [ ] **Step 1: Write the failing tests**

In `src/notifications/scheduleSync.test.ts`, find the describe block holding `treatmentRec` and the `dose` helper (around line 470). Replace the existing test named `'scopes dose scalars to the selected child'` (line 496) with the three tests below, and add them after `'projects treatments and per-treatment dose scalars'`.

The existing test's assertion survives, because a dose logged for another child must still not count. What changes is the REASON: it is scoped by the treatment's own child now, not by the selection.

```ts
  it("scopes each treatment's doses to that treatment's own child", async () => {
    const { desired, useAppStore } = await setup();
    useAppStore.setState({
      selectedChildId: 'c1',
      treatments: [treatmentRec],
      entries: [dose('c2', Date.now() - 60_000)],
    });
    await flush();

    // The dose belongs to another child, so it cannot count toward a c1 treatment.
    expect(desired.mock.calls.at(-1)![0].treatmentDoses.treatment1).toEqual({ today: 0, lastAt: null });
  });

  it("gives a non-selected child's treatment its own scalars", async () => {
    // The point of the whole change. Until now only the selected child's
    // treatments got a key at all, so a sibling's regimen was invisible here.
    const { desired, useAppStore } = await setup();
    const doseAt = Date.now() - 60_000;
    useAppStore.setState({
      selectedChildId: 'c1',
      treatments: [treatmentRec, { ...treatmentRec, id: 'treatment2', childId: 'c2' }],
      entries: [dose('c2', doseAt)],
    });
    await flush();

    const input = desired.mock.calls.at(-1)![0];
    expect(input.treatmentDoses.treatment2).toEqual({ today: 1, lastAt: doseAt });
  });

  it('does not let one child\'s dose settle a sibling\'s identically named treatment', async () => {
    // The hazard this task exists to avoid. Dose-to-treatment attribution is by
    // NAME (a MedicationEntry carries no treatment reference that survives
    // sync), and two children on the same medicine is the ordinary case. Handing
    // `treatmentDoseScalars` both children's treatments and both children's
    // entries at once would cross-attribute silently.
    const { desired, useAppStore } = await setup();
    const doseAt = Date.now() - 60_000;
    useAppStore.setState({
      selectedChildId: 'c1',
      treatments: [treatmentRec, { ...treatmentRec, id: 'treatment2', childId: 'c2' }],
      entries: [dose('c1', doseAt)],
    });
    await flush();

    const input = desired.mock.calls.at(-1)![0];
    expect(input.treatmentDoses.treatment1).toEqual({ today: 1, lastAt: doseAt });
    expect(input.treatmentDoses.treatment2).toEqual({ today: 0, lastAt: null });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/notifications/scheduleSync.test.ts`
Expected: the two new tests FAIL. `treatmentDoses.treatment2` is `undefined`, because only the selected child's treatments are passed to the scalar builder. The renamed first test still passes.

- [ ] **Step 3: Build the scalars per child**

In `src/notifications/scheduleSync.ts`, replace the `treatmentDoses:` property inside `toInput`'s returned object (lines 77-90, the comment block included) with a plain `treatmentDoses,` reference, and build the map above the `return` statement, after the entry walk:

```ts
  // Doses for EVERY child's treatments, grouped by the treatment's own child.
  //
  // Grouped rather than passed in one call, and that is load-bearing rather
  // than tidy: `treatmentDoseScalars` attributes a dose to a treatment by
  // trimmed, case-insensitive NAME, because a `MedicationEntry` carries no
  // treatment reference that survives sync. One call over every treatment and
  // every entry would let a dose logged for one child settle a sibling's
  // identically named regimen, and two children on the same medicine is
  // ordinary rather than contrived.
  //
  // Grouped by `treatment.childId` rather than by walking `s.children`, so that
  // every treatment the store holds gets a key even if its child is gone. That
  // keeps `treatmentDoseScalars`' contract intact: a missing key means the
  // treatment was never considered, which is exactly what `treatmentDoseGiven`
  // reads it as.
  const treatmentsByChild = new Map<string, Treatment[]>();
  for (const t of s.treatments) {
    const group = treatmentsByChild.get(t.childId);
    if (group) group.push(t);
    else treatmentsByChild.set(t.childId, [t]);
  }
  const treatmentDoses: Record<string, { today: number; lastAt: number | null }> = {};
  for (const [childId, group] of treatmentsByChild) {
    Object.assign(treatmentDoses, treatmentDoseScalars(group, entriesForChild(s.entries, childId), now));
  }
```

Add the `Treatment` type import at the top of the file if it is not already there:

```ts
import type { Treatment } from '@/types/models';
```

- [ ] **Step 4: Correct the stale comment in `treatmentDoseGiven`**

In `src/notifications/scheduled.ts`, inside the doc comment above `treatmentDoseGiven` (around lines 806-812), replace the sentence claiming `scheduleSync` hands over the selected child's treatments only:

```
 * Answers "not given" whenever it cannot answer confidently. A missing scalar
 * entry means the treatment was never CONSIDERED, not that no dose was logged:
 * `treatmentDoseScalars` gives every treatment it was handed a key, and
 * `scheduleSync` now hands it every child's treatments, grouped so that one
 * child's dose cannot settle a sibling's identically named regimen. A key can
 * therefore only be missing for a treatment that left the store mid-flight, and
 * answering "given" on that would tell a parent a dose had been given when the
 * app had simply never looked.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/notifications/scheduleSync.test.ts && npx tsc --noEmit && npx eslint .`
Expected: PASS, with no new tsc or eslint output beyond the pre-existing failures listed in Global Constraints.

- [ ] **Step 6: Commit**

```bash
git add src/notifications/scheduleSync.ts src/notifications/scheduled.ts src/notifications/scheduleSync.test.ts
git commit -m "feat(reminders): dose scalars for every child, grouped so names cannot cross"
```

---

### Task 2: Per-child milestone keys, and a nudge per child

The catch-up branch loops `input.children` instead of finding the selected one. That is only safe once the two key lists can answer for each child, so the field shape and the loop change together: splitting them would leave a commit where every sibling reads as "has reached nothing" and gets nudged about milestones logged months ago.

**Files:**
- Modify: `src/notifications/scheduled.ts` (`ScheduleInput` lines 101-110, `milestoneReminders` line 673, `desiredScheduled` lines 735-744), `src/notifications/scheduleSync.ts` (`toInput` lines 91-95)
- Test: `src/notifications/scheduled.test.ts` (the `input` fixture at line 49, the milestone describe around 1100-1180)

**Interfaces:**
- Consumes: `reachedForChild(entries: Entry[], childId: string | undefined): Map<string, MilestoneEntry>` from `@/lib/milestones`, already imported by `scheduleSync.ts`.
- Produces, on `ScheduleInput`:
  - `reachedMilestoneKeysByChild: Record<string, readonly string[]>` replacing `reachedMilestoneKeys`
  - `answeredMilestoneKeysByChild: Record<string, readonly string[]>` replacing `answeredMilestoneKeys`

- [ ] **Step 1: Write the failing tests**

In `src/notifications/scheduled.test.ts`, update the shared `input` fixture (line 49) so the two old fields become the two new maps:

```ts
  reachedMilestoneKeysByChild: {},
  answeredMilestoneKeysByChild: {},
```

Then, in the milestone catch-up describe (its `run` helper is at line 1107), update the two tests that pass the old fields and add the new coverage. Replace the existing `'skips milestones already logged or already answered'` with the keyed form, and replace `'only ever covers the selected child'` (line 1173) entirely:

```ts
  it('skips milestones already logged or already answered', () => {
    const out = run({
      reachedMilestoneKeysByChild: { c1: ['lifts-head'] },
      answeredMilestoneKeysByChild: { c1: ['first-smile'] },
    });
    expect(out.some((n) => n.identifier.includes('lifts-head'))).toBe(false);
    expect(out.some((n) => n.identifier.includes('first-smile'))).toBe(false);
  });

  it('nudges every child, each against their own history', () => {
    // Was "only ever covers the selected child". The keys can answer per child
    // now, so a sibling is no longer read as having reached nothing.
    const sibling = child({ id: 'c2', first: 'Wren', birth: at(2026, 9, 1) });
    const out = run({
      children: [born, sibling],
      reachedMilestoneKeysByChild: { c1: ['lifts-head'] },
    });

    expect(out.some((n) => n.identifier.includes(':c1:'))).toBe(true);
    expect(out.some((n) => n.identifier.includes(':c2:'))).toBe(true);
    // c1 logged it, c2 did not, so only c2 is nudged about it.
    const liftsHead = out.filter((n) => n.identifier.includes('lifts-head'));
    expect(liftsHead).toHaveLength(1);
    expect(liftsHead[0].identifier).toContain(':c2:');
  });

  it('gives two children closing the same window two alerts, each deep-linking to its own child', () => {
    const sibling = child({ id: 'c2', first: 'Wren', birth: at(2026, 9, 1) });
    const out = run({ children: [born, sibling] });

    const sameMorning = out.filter((n) => n.fireAt === out[0].fireAt);
    expect(sameMorning).toHaveLength(2);
    expect(sameMorning.map((n) => n.data.url).sort()).toEqual([
      '/milestones?child=c1',
      '/milestones?child=c2',
    ]);
    expect(sameMorning.map((n) => n.title).sort()).toEqual(
      [`A milestone to check for Rowan.`, `A milestone to check for Wren.`].sort(),
    );
  });

  it("reads a child with no entry in either map as having reached nothing", () => {
    // The maps are sparse: a child who has logged no milestone and answered no
    // prompt has no key at all, which must not throw and must not suppress.
    const out = run({ reachedMilestoneKeysByChild: {}, answeredMilestoneKeysByChild: {} });
    expect(out.length).toBeGreaterThan(0);
  });
```

The `'changes the identifier when one of a batch is logged'` test also passes the old field. Update it in place:

```ts
    const after = run({ reachedMilestoneKeysByChild: { c1: ['first-smile'] } }).find((n) =>
      n.identifier.includes('lifts-head'),
    );
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/notifications/scheduled.test.ts`
Expected: FAIL. TypeScript rejects the unknown fixture properties, and the two-children tests find only c1's alerts.

- [ ] **Step 3: Reshape the two fields on `ScheduleInput`**

In `src/notifications/scheduled.ts`, replace the `reachedMilestoneKeys` and `answeredMilestoneKeys` members (lines 101-110) with:

```ts
  /** Per child, the catalog keys that child has already logged a milestone
   *  entry for. Per child rather than one list since 0.15.2: the catch-up nudge
   *  covers every child, and one list could only ever answer for one of them,
   *  which read every sibling as having reached nothing. Plain keys rather than
   *  entries, so this file stays ignorant of `Entry`. Sparse: a child with
   *  nothing logged has no key, which reads correctly as "reached nothing". */
  reachedMilestoneKeysByChild: Record<string, readonly string[]>;
  /** Per child, the catalog keys whose home-screen catch-up nudge that child's
   *  parent has already answered (yes, not yet, or dismissed). Persisted by
   *  src/data/milestonePrompts.ts, which already stores it keyed by child, so
   *  this is that map passed straight through. */
  answeredMilestoneKeysByChild: Record<string, readonly string[]>;
```

- [ ] **Step 4: Read them per child in `milestoneReminders`**

In `src/notifications/scheduled.ts`, replace the `done` set (line 673):

```ts
  const done = new Set([
    ...(input.reachedMilestoneKeysByChild[child.id] ?? []),
    ...(input.answeredMilestoneKeysByChild[child.id] ?? []),
  ]);
```

- [ ] **Step 5: Loop every child in the catch-up branch**

In `desiredScheduled`, replace the `milestoneCatchUp` branch (lines 735-744):

```ts
  if (input.prefs.milestoneCatchUp) {
    // Every child, each against their own two key lists. This was the selected
    // child alone until 0.15.2, when `reachedMilestoneKeys` could only describe
    // one of them; looping then would have read every sibling as having reached
    // nothing and nudged their parent about milestones logged months ago.
    for (const c of input.children) out.push(...milestoneReminders(c, input, now));
  }
```

- [ ] **Step 6: Project the maps in `toInput`**

In `src/notifications/scheduleSync.ts`, replace the `reachedMilestoneKeys` and `answeredMilestoneKeys` properties (lines 91-95) with:

```ts
    // Per child, so the catch-up nudge can answer for each of them. One
    // `reachedForChild` pass per child, where there was one pass in total
    // before: `toInput` already walks `s.entries` on every reconcile and a
    // household is one to four children, so this is not worth folding into the
    // walk above until it measurably costs something.
    reachedMilestoneKeysByChild: Object.fromEntries(
      s.children.map((c) => [c.id, [...reachedForChild(s.entries, c.id).keys()]]),
    ),
    // Already keyed by child in the store, so it passes straight through.
    answeredMilestoneKeysByChild: s.answeredMilestonePrompts,
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit && npx eslint .`
Expected: PASS. Run the whole suite, not just the two notification files: the fixture reshape can reach any test that builds a `ScheduleInput`.

- [ ] **Step 8: Commit**

```bash
git add src/notifications/scheduled.ts src/notifications/scheduleSync.ts src/notifications/scheduled.test.ts
git commit -m "feat(reminders): nudge every child about their own milestones"
```

---

### Task 3: Treatment reminders for every child, named

The rule loops every treatment and gates each on its OWN child. The alert gains the child's name, in the shape the stale-timer reminder already uses.

**Files:**
- Modify: `src/notifications/scheduled.ts` (`ScheduleInput.treatments` doc comment lines 89-95, `treatmentNote` 486, `treatmentTimesOfDayReminders` 527, `treatmentEveryHoursReminders` 569, `treatmentReminders` 617-651)
- Test: `src/notifications/scheduled.test.ts` (the treatment describe, its `run` helper at line 960)

**Interfaces:**
- Consumes: `isTreatmentActiveToday(treatment: Treatment, todayMidnight: number, childId: string): boolean` from `@/store/selectors`, already imported.
- Produces:
  - `treatmentNote(treatment: Treatment, child: Child, fireAt: number): ScheduledNotification`
  - `treatmentTimesOfDayReminders(treatment: Treatment, child: Child, input: ScheduleInput, now: number, todayMidnight: number): ScheduledNotification[]`
  - `treatmentEveryHoursReminders(treatment: Treatment, child: Child, input: ScheduleInput, now: number): ScheduledNotification[]`
  - Title format: `` `${child.first} · ${treatment.name.trim()} due` ``

- [ ] **Step 1: Write the failing tests**

In `src/notifications/scheduled.test.ts`, in the treatment describe, replace the test `'schedules nothing for a treatment belonging to another child'` (line 910) and `'schedules nothing while the selected child is expected, since a treatment cannot be dosed against a due date'` (line 914) with the tests below. Note the `run` helper there passes `children` through `over`, and the default `input` fixture has `children: []`, so every test that expects an alert must now supply the child. That is the substantive change to this describe: a treatment with no child in the roster schedules nothing.

Add `children: [child()]` to the `run` helper so the existing tests keep their subject:

```ts
  const run = (over: Partial<ScheduleInput>, now: number, p: Partial<ReminderPrefs> = {}) =>
    desiredScheduled(input({ prefs: only(p), children: [child()], ...over }), now);
```

Then the new tests:

```ts
  it('schedules nothing for a treatment whose child is not in the roster', () => {
    // An orphan record. `deleteChild` purges a deleted child's treatments as of
    // 0.15.2, so this is the stale-record case rather than the ordinary one, and
    // an alert naming nobody is worse than no alert.
    expect(run({ treatments: [treatment({ childId: 'c2' })] }, at(2026, 9, 2, 6))).toEqual([]);
  });

  it("covers a child who is not selected", () => {
    // The point of the change: a sibling's regimen now produces alerts. There is
    // no selection in the input at all after this task's sibling task, so what
    // this pins is that every treatment with a live child is scheduled.
    const sibling = child({ id: 'c2', first: 'Wren' });
    const out = run(
      {
        children: [child(), sibling],
        treatments: [treatment({ id: 'treatment2', childId: 'c2', timesOfDay: ['morning'] })],
      },
      at(2026, 9, 2, 6),
    );
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((n) => n.identifier.includes('treatment2'))).toBe(true);
  });

  it('names the child in the title, so two children are told apart', () => {
    const sibling = child({ id: 'c2', first: 'Wren' });
    const out = run(
      {
        children: [child(), sibling],
        treatments: [
          treatment({ timesOfDay: ['morning'] }),
          treatment({ id: 'treatment2', childId: 'c2', timesOfDay: ['morning'] }),
        ],
      },
      at(2026, 9, 2, 6),
    );
    const first = out.filter((n) => n.fireAt === at(2026, 9, 2, 8));
    expect(first.map((n) => n.title).sort()).toEqual(['Rowan · Omeprazol due', 'Wren · Omeprazol due']);
  });

  it('gates `expected` per treatment, not across the household', () => {
    // Every other reminder kind guards `child.expected`; this one must too,
    // because resolveLogDeepLink (src/lib/logDeepLink.ts) refuses to open
    // anything for an expected child, so a scheduled "X due" alert would be a
    // tap the app itself cannot service. Applied per child now: one expecting
    // child must not silence a born sibling's regimen.
    const expecting = child({ id: 'c2', first: 'Wren', expected: true });
    const out = run(
      {
        children: [child(), expecting],
        treatments: [
          treatment({ timesOfDay: ['morning'] }),
          treatment({ id: 'treatment2', childId: 'c2', timesOfDay: ['morning'] }),
        ],
      },
      at(2026, 9, 2, 6),
    );
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((n) => n.identifier.includes('treatment1'))).toBe(true);
  });

  it("keeps each treatment's dose suppression on its own scalars", () => {
    // Two children on the same medicine. c1 has had today's dose, c2 has not.
    const sibling = child({ id: 'c2', first: 'Wren' });
    const out = run(
      {
        children: [child(), sibling],
        treatments: [
          treatment({ timesOfDay: ['morning'] }),
          treatment({ id: 'treatment2', childId: 'c2', timesOfDay: ['morning'] }),
        ],
        treatmentDoses: {
          treatment1: { today: 1, lastAt: at(2026, 9, 2, 8) },
          treatment2: { today: 0, lastAt: null },
        },
      },
      at(2026, 9, 2, 9),
    );
    const today = out.filter((n) => n.fireAt < at(2026, 9, 3));
    expect(today.every((n) => n.identifier.includes('treatment2'))).toBe(true);
  });
```

Also update the existing `'emits one notification per treatment when two are due at the same slot'` test: both treatments belong to c1, so its expectation becomes `['Rowan · Amoxicilline due', 'Rowan · Omeprazol due']`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/notifications/scheduled.test.ts`
Expected: FAIL. Titles have no child prefix, the sibling's treatment schedules nothing, and the expecting-child test silences the whole household.

- [ ] **Step 3: Thread the child through the note builder**

In `src/notifications/scheduled.ts`, change `treatmentNote` (line 486) to take the child, and prefix the title. Leave the identifier, body, data and every comment in that function untouched:

```ts
function treatmentNote(treatment: Treatment, child: Child, fireAt: number): ScheduledNotification {
```

```ts
    // The child leads, in the shape `staleReminders` already uses. Two siblings
    // on the same medicine would otherwise produce two alerts reading exactly
    // alike, and the identifier that tells them apart is not on screen. Named
    // unconditionally rather than only when the household has more than one
    // child in treatment: a title that changes with unrelated state would have
    // `diffScheduled` rewrite every pending alert the moment a second regimen
    // starts.
    title: `${child.first} · ${treatment.name.trim()} due`,
```

- [ ] **Step 4: Pass the child down both builders**

Add the `child: Child` parameter after `treatment` in both builders, and update the `treatmentNote(...)` call inside each. Both already receive `input`, but resolving the child once in the caller keeps the lookup out of two loops. Leave every doc comment on these two functions as it is.

`treatmentTimesOfDayReminders` (line 527) becomes:

```ts
function treatmentTimesOfDayReminders(
  treatment: Treatment,
  child: Child,
  input: ScheduleInput,
  now: number,
  todayMidnight: number,
): ScheduledNotification[] {
```

`treatmentEveryHoursReminders` (line 569) becomes:

```ts
function treatmentEveryHoursReminders(
  treatment: Treatment,
  child: Child,
  input: ScheduleInput,
  now: number,
): ScheduledNotification[] {
```

Inside each, the single `out.push(treatmentNote(treatment, fireAt))` call becomes:

```ts
    out.push(treatmentNote(treatment, child, fireAt));
```

- [ ] **Step 5: Loop every treatment against its own child**

Replace the body of `treatmentReminders` (lines 617-651), keeping the function's doc comment above it:

```ts
function treatmentReminders(input: ScheduleInput, now: number): ScheduledNotification[] {
  const todayMidnight = startOfDay(now);
  const out: ScheduledNotification[] = [];
  for (const treatment of input.treatments) {
    // The treatment's OWN child. Scoped to the selected child until 0.15.2,
    // which was forced before 0.15.0 (a server load held one child, so a
    // sibling's dose history read as empty) and merely narrow afterwards.
    const child = input.children.find((c) => c.id === treatment.childId);
    // No child in the roster: an orphan record whose child is gone. `deleteChild`
    // purges treatments as of 0.15.2, so this is the stale-record case, and an
    // alert that can name nobody is worse than no alert.
    if (!child) continue;
    // Gate on `expected` the same way `dueReminders`, `ageReminders` and
    // `napReminders` do, but for a different reason: those three have no fact to
    // report yet while a child is due rather than born. A treatment cannot be
    // dosed against a due date either, AND `resolveLogDeepLink`
    // (src/lib/logDeepLink.ts) refuses to open anything for an expected child,
    // so without this guard the alert would fire and its own tap target would
    // refuse to service it. Per treatment, so one expecting child cannot
    // silence a born sibling's regimen.
    if (child.expected) continue;
    // Covers the paused flag and the fromDate/toDate range too.
    if (!isTreatmentActiveToday(treatment, todayMidnight, treatment.childId)) continue;
    // A treatment always carries a name (the editor requires one), but gate on it the
    // same way `logMedicationFromTreatment` does: an alert titled " due" whose tap
    // that action then refuses would be a dead tap.
    if (!treatment.name.trim()) continue;
    out.push(
      ...(treatment.scheduleMode === 'everyHours'
        ? treatmentEveryHoursReminders(treatment, child, input, now)
        : treatmentTimesOfDayReminders(treatment, child, input, now, todayMidnight)),
    );
  }
  return out;
}
```

- [ ] **Step 6: Correct the `treatments` doc comment**

In `ScheduleInput` (lines 89-95), replace the `treatments` comment:

```ts
  /** Every treatment the store holds. `treatmentReminders` covers each of them
   *  against its own child, as of 0.15.2. It was scoped to the selected child
   *  before that: forced until 0.15.0 (a server load held only the child the
   *  last fetch asked for, so a sibling's dose history read as empty), then
   *  merely narrow until the product decision was made. */
  treatments: Treatment[];
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit && npx eslint .`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/notifications/scheduled.ts src/notifications/scheduled.test.ts
git commit -m "feat(reminders): a treatment alert for every child, each naming its own"
```

---

### Task 4: Delete the selection from the input

Tasks 2 and 3 removed the last two readers. The field and the subscriber gate entry that serves it both go, which is also what stops a child switch from rebuilding the whole reminder set.

**Files:**
- Modify: `src/notifications/scheduled.ts` (`ScheduleInput.selectedChildId`, lines 85-88), `src/notifications/scheduleSync.ts` (`toInput`'s `selectedChildId` property line 75, the gate comment 185-196, the gate entry 219)
- Test: `src/notifications/scheduled.test.ts` (fixture line 49 and the overrides at 544, 662-663, 779, 932, 961, 1249, 1258, 1267), `src/notifications/scheduleSync.test.ts` (lines 355-370 and 398-407), `src/notifications/applySchedule.android.test.ts` (line 81)

**Interfaces:**
- Consumes: nothing.
- Produces: `ScheduleInput` no longer has `selectedChildId`. No other signature changes.

**Do NOT touch** `src/notifications/sync.test.ts` or `src/notifications/register.android.test.ts`. Both read the store's selection for a different subsystem (timer notifications, and which child to select when a notification is tapped). Neither builds a `ScheduleInput`.

- [ ] **Step 1: Write the failing tests**

In `src/notifications/scheduleSync.test.ts`, invert the test at line 398. It currently asserts a rebuild on selection change:

```ts
  it('does not reconcile when only the selected child changes', async () => {
    // Nothing in the desired set reads the selection as of 0.15.2: treatment
    // reminders cover every child and the milestone catch-up nudge loops them,
    // so a switch cannot change what Android should hold. The justification for
    // the old entry was the two rules that did read it; both are gone, and the
    // even older one (an ownerless sleep timer resolving to
    // `timer.childId ?? selectedChildId`) was retired before that.
    const { desired, useAppStore } = await setup();
    const builds = desired.mock.calls.length;
    useAppStore.setState({ selectedChildId: 'c2' });
    await flush();
    expect(desired.mock.calls.length).toBe(builds);
  });
```

In the same file, the test at line 355 asserts `input?.selectedChildId` is projected. Drop that one assertion (line 370) and rename the test to `'projects the latest ended sleep per child'`, keeping every other assertion in it.

In `src/notifications/scheduled.test.ts`, the nap test at lines 662-663 runs the same input twice, once per selection, to prove naps ignore the selection. With no selection in the input, the two lines collapse. Replace them with one call and rewrite the test name and comment:

```ts
  it("lets an ownerless sleep timer suppress nobody's nudge", () => {
    // Nothing here consults a selection any more (0.15.2 removed it from the
    // input entirely), so an ownerless timer answers for nobody at all.
    expect(naps(napInput({ timers: [t] })).length).toBe(1);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/notifications/scheduleSync.test.ts`
Expected: FAIL. The inverted test still sees a rebuild, because the gate entry is still there.

- [ ] **Step 3: Delete the field**

In `src/notifications/scheduled.ts`, delete the `selectedChildId` member and its doc comment (lines 85-88).

In `src/notifications/scheduleSync.ts`, delete `selectedChildId: s.selectedChildId,` from the returned object (line 75).

- [ ] **Step 4: Delete the gate entry and rewrite its comment**

In `src/notifications/scheduleSync.ts`, delete the `state.selectedChildId === previous.selectedChildId` line (219) from the slice comparison, and replace the comment block that justifies it (lines 185-196) with:

```ts
    // `selectedChildId` is deliberately NOT compared here, and its absence is
    // load-bearing rather than an oversight. Nothing in the desired set reads
    // the selection as of 0.15.2: treatment reminders cover every child, and the
    // milestone catch-up nudge loops them. Comparing it would rebuild the whole
    // set and make a native round trip every time the user switches children,
    // for a set that cannot have changed.
    //
    // Two retired justifications, so nobody restores this by rediscovering
    // them: `napReminders` once resolved an ownerless sleep timer's owner as
    // `timer.childId ?? selectedChildId` (a timer belongs to whoever started it
    // now, see `timerBelongsTo`), and the treatment and milestone rules once
    // scoped themselves to the selection.
```

- [ ] **Step 5: Remove it from every `ScheduleInput` fixture**

Delete `selectedChildId` from the fixture at `src/notifications/scheduled.test.ts:49` and from every override that sets it in that file (the remaining ones are around lines 544, 779, 932, 961, 1249, 1258, 1267; `npx tsc --noEmit` lists them all). Delete it from the fixture at `src/notifications/applySchedule.android.test.ts:81`.

These are mechanical deletions. Do not change any assertion while doing them.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit && npx eslint .`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/notifications/scheduled.ts src/notifications/scheduleSync.ts src/notifications/scheduled.test.ts src/notifications/scheduleSync.test.ts src/notifications/applySchedule.android.test.ts
git commit -m "feat(reminders): drop the selected child from the schedule input"
```

---

### Task 5: Verify the whole change, and close the queue item

**Files:**
- Modify: `docs/superpowers/plans/2026-08-02-multichild-server-data.md` (item A4, line 111)

- [ ] **Step 1: Run everything**

Run: `npx vitest run && npx tsc --noEmit && npx eslint .`
Expected: the full suite passes. Compare the tsc and eslint output against the pre-existing failures listed in Global Constraints; there must be nothing new.

- [ ] **Step 2: Confirm no reader of the selection survives in the scheduler**

Run: `grep -rn "selectedChildId" src/notifications/`
Expected: hits only in `sync.ts` / `sync.test.ts` and `register.android.ts` / `register.android.test.ts`, which are the timer-notification and tap-handling subsystems. No hit in `scheduled.ts`, `scheduleSync.ts`, `scheduled.test.ts`, `scheduleSync.test.ts` or `applySchedule.android.test.ts`.

- [ ] **Step 3: Tick A4**

In `docs/superpowers/plans/2026-08-02-multichild-server-data.md`, change item A4 (line 111) from `- [ ]` to `- [x]` and append, at the end of its paragraph, keeping the existing indentation:

```
      Done in 0.15.3: both rules now cover every child, and `selectedChildId`
      left `ScheduleInput` entirely. See
      `specs/2026-08-03-reminder-scoping-design.md`.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-08-02-multichild-server-data.md
git commit -m "docs(plans): close A4, the last open item in the 0.15.0 queue"
```

- [ ] **Step 5: Report, do not release**

Report the suite counts and stop. The release flow (merge, tag, docker build and push, preview APK, `docker compose up -d`) is the user's to trigger explicitly and must not be run off the back of this plan.

An on-device check is worth OFFERING but is not part of this plan: notification scheduling is fully unit-tested here, and the native layer (`applySchedule`) is untouched. The one device-visible consequence to mention is that every pending treatment alert is rescheduled once after the upgrade, because its title gained the child prefix.

---

## Notes for the implementer

- **The four rewritten assertions are the change, not collateral.** `scheduleSync.test.ts:496`, `scheduled.test.ts:914`, `scheduled.test.ts:1173` and `scheduleSync.test.ts:398` all assert the narrow behaviour. Rewriting them is the point; do not try to keep them passing.
- **Never hand `treatmentDoseScalars` more than one child's data.** It attributes doses by name. This is the only way this change can silently corrupt something a parent relies on.
- **Do not "simplify" the grouping in Task 1 into a walk over `s.children`.** Grouping by `treatment.childId` is what keeps a key present for a treatment whose child is gone, which is what `treatmentDoseGiven` reads as "never considered".
- The middle dot in the title is U+00B7, matching `staleReminders`. Not a hyphen, not an em-dash.
