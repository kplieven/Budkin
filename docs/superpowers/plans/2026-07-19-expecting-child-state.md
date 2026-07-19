# Expecting Child State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a parent add their baby before the birth, so Budkin is set up and waiting rather than something to configure in the first exhausted week.

**Architecture:** `Child` gains an optional `expected` flag; while it is true, `birth` holds the DUE date. Nothing reads the flag inline for display: one helper, `ageOrDueLabel`, owns the meaning and is called by all four age display sites. Sync is held back with three local-side guards until a single store action, `confirmBirth`, releases the child as an ordinary unsynced local child.

**Tech Stack:** Expo SDK 56, expo-router 56, React 19, React Native 0.85, zustand v5 store (`src/store/useAppStore.ts`), vitest.

## Global Constraints

- **Expo version:** SDK 56. Read the versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any Expo API code (per `AGENTS.md`).
- **No em-dashes** in any prose, comment, or UI copy. Use commas, colons, or separate sentences.
- **zustand v5 selectors:** never return a fresh reference from a `useAppStore` selector. No inline `.filter`/`.map`/object literals. Select raw values or primitives and derive in render, or web routes blank-screen with "Maximum update depth exceeded". `(s) => s.children.find(...)` is fine (it returns an element, not a new array).
- **`birth` stays a required `number`.** Do not make it optional. `expected` is the only new field.
- **Never push an expected child to Baby Buddy.** Its `birth_date` is a real date; a future one is invalid data on someone's server.
- **Tests:** `npx vitest run`. There is no component test infrastructure, only vitest over `src/lib`, `src/data`, and `src/store`. UI is verified by the web run in Task 10.
- **Typecheck:** `npx tsc --noEmit`. **Lint:** `npm run lint`.
- **Known pre-existing lint failures**, in files this work does not touch: `src/lib/photo.ts` (unresolved `expo-image-picker`) and `src/data/sync.test.ts` (array-type warning). Neither is yours.
- **Path alias:** `@/` maps to `src/`.
- **Branch:** work continues on `expecting-child-state`, which already holds the spec commit.
- **Do NOT start the Expo dev server or run Playwright.** Task 10 is a controller-run pass. New routes are not being added here, so the typed-routes regeneration issue from the previous branch does not apply.

---

### Task 1: The `expected` flag and the countdown label

The whole feature rests on one field and one display helper. Both land together so the helper is never written against a type that does not exist yet.

**Files:**
- Modify: `src/types/models.ts:15-29` (add one field to `Child`)
- Modify: `src/lib/format.ts` (add `ageOrDueLabel` below the existing `ageMonths`)
- Modify: `src/lib/format.test.ts` (add a describe block; create the file only if it does not exist)

**Interfaces:**
- Consumes: nothing.
- Produces: `Child.expected?: boolean`, and `ageOrDueLabel(birth: number, expected: boolean, now: number): string` from `@/lib/format`. Tasks 3 through 9 use both.

- [ ] **Step 1: Add the field to `Child`**

In `src/types/models.ts`, inside the `Child` interface, directly after the `birth` field and its comment, add:

```ts
  /** true while the baby is not yet born; `birth` then holds the DUE date */
  expected?: boolean;
```

- [ ] **Step 2: Write the failing tests**

Check whether `src/lib/format.test.ts` exists. If it does, append this describe block. If it does not, create the file with the import line plus this block.

```ts
import { describe, expect, it } from 'vitest';

import { ageOrDueLabel } from '@/lib/format';

describe('ageOrDueLabel', () => {
  const DAY = 86400000;
  const NOW = new Date(2026, 5, 15, 12, 0, 0).getTime(); // 15 June 2026, midday

  it('falls back to the plain age when the child is not expected', () => {
    expect(ageOrDueLabel(NOW - 3 * DAY, false, NOW)).toBe('3 days old');
    expect(ageOrDueLabel(NOW - 60 * DAY, false, NOW)).toBe('8 weeks old');
  });

  it('counts down in whole weeks when the due date is far out', () => {
    expect(ageOrDueLabel(NOW + 42 * DAY, true, NOW)).toBe('Due in 6 weeks');
  });

  it('uses weeks from 15 days out', () => {
    expect(ageOrDueLabel(NOW + 15 * DAY, true, NOW)).toBe('Due in 2 weeks');
  });

  it('uses days from 14 days out down to 2', () => {
    expect(ageOrDueLabel(NOW + 14 * DAY, true, NOW)).toBe('Due in 14 days');
    expect(ageOrDueLabel(NOW + 9 * DAY, true, NOW)).toBe('Due in 9 days');
    expect(ageOrDueLabel(NOW + 2 * DAY, true, NOW)).toBe('Due in 2 days');
  });

  it('says tomorrow at one day out', () => {
    expect(ageOrDueLabel(NOW + 1 * DAY, true, NOW)).toBe('Due tomorrow');
  });

  it('holds at a calm phrase on the day and after it', () => {
    expect(ageOrDueLabel(NOW, true, NOW)).toBe('Due any day now');
    expect(ageOrDueLabel(NOW - 1 * DAY, true, NOW)).toBe('Due any day now');
    expect(ageOrDueLabel(NOW - 30 * DAY, true, NOW)).toBe('Due any day now');
  });

  it('never counts up past the due date', () => {
    const label = ageOrDueLabel(NOW - 8 * DAY, true, NOW);
    expect(label).not.toMatch(/overdue|late|-/);
    expect(label).toBe('Due any day now');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/format.test.ts`
Expected: FAIL, `ageOrDueLabel` is not exported from `@/lib/format`.

- [ ] **Step 4: Implement the helper**

In `src/lib/format.ts`, directly below the existing `ageMonths` function, add:

```ts
/** Age for a born child, a countdown for an expected one. Takes primitives
 *  rather than a Child so the Android widget, which cannot import store types,
 *  shares exactly this logic. Never counts up past the due date: a parent
 *  staring at their home screen does not need "8 days overdue". */
export function ageOrDueLabel(birth: number, expected: boolean, now: number): string {
  if (!expected) return ageStr(birth, now);
  const days = Math.ceil((birth - now) / 86400000);
  if (days <= 0) return 'Due any day now';
  if (days === 1) return 'Due tomorrow';
  if (days <= 14) return `Due in ${days} days`;
  return `Due in ${Math.round(days / 7)} weeks`;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/format.test.ts`
Expected: PASS, 7 tests in the `ageOrDueLabel` block.

- [ ] **Step 6: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors, all tests pass. Adding an OPTIONAL field to `Child` breaks no existing construction site.

- [ ] **Step 7: Commit**

```bash
git add src/types/models.ts src/lib/format.ts src/lib/format.test.ts
git commit -m "feat(expecting): expected flag on Child, countdown label helper"
```

---

### Task 2: Due-date clamping and the shared date row

Two pieces of date plumbing that everything downstream needs. `clampBirth` pins its result to today or earlier, which is exactly wrong for a due date, so it gains a sibling. And the DD/MM/YYYY input row becomes a component before there are three copies of it.

**Files:**
- Modify: `src/lib/birthDate.ts`
- Modify: `src/lib/birthDate.test.ts`
- Create: `src/components/DateFields.tsx`
- Modify: `src/app/setup/baby.tsx` (replace the born branch's inline date row with the component)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `clampDueDate(yStr: string, mStr: string, dStr: string): number` from `@/lib/birthDate`. Tasks 8 and 9 use it.
  - `DateFields({ day, month, year, onDay, onMonth, onYear })` from `@/components/DateFields`. Tasks 6 and 8 use it.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/birthDate.test.ts`. Add `clampDueDate` to the existing import from `@/lib/birthDate`.

```ts
describe('clampDueDate', () => {
  const DAY = 86400000;

  it('lets a normal future due date through untouched', () => {
    const d = new Date(midnight() + 60 * DAY);
    expect(clampDueDate(String(d.getFullYear()), String(d.getMonth() + 1), String(d.getDate()))).toBe(
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(),
    );
  });

  it('leaves a past date alone, so an overdue pregnancy is not rewritten', () => {
    expect(clampDueDate('2020', '3', '15')).toBe(new Date(2020, 2, 15).getTime());
  });

  it('clamps a due date beyond 300 days to the 300 day ceiling', () => {
    // Build both the input and the expectation with setDate, not by adding
    // milliseconds: adding 300 days of ms crosses a DST boundary in most
    // timezones and lands at 23:00 or 01:00 rather than local midnight, which
    // would make this test fail only part of the year.
    const far = new Date();
    far.setHours(0, 0, 0, 0);
    far.setDate(far.getDate() + 900);

    const ceiling = new Date();
    ceiling.setHours(0, 0, 0, 0);
    ceiling.setDate(ceiling.getDate() + 300);

    const got = clampDueDate(String(far.getFullYear()), String(far.getMonth() + 1), String(far.getDate()));
    expect(got).toBe(ceiling.getTime());
  });

  it('keeps the 1900 lower bound', () => {
    expect(clampDueDate('1800', '5', '4')).toBe(new Date(1900, 4, 4).getTime());
  });

  it('clamps the day to the days in that month, honouring leap years', () => {
    expect(clampDueDate('2024', '2', '30')).toBe(new Date(2024, 1, 29).getTime());
  });

  it('clamps an out-of-range month into 1-12', () => {
    expect(clampDueDate('2020', '13', '9')).toBe(new Date(2020, 11, 9).getTime());
  });

  it('falls back to 1 January of the current year on unparseable input', () => {
    expect(clampDueDate('', 'abc', '')).toBe(new Date(new Date().getFullYear(), 0, 1).getTime());
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/birthDate.test.ts`
Expected: FAIL, `clampDueDate` is not exported.

- [ ] **Step 3: Implement it**

In `src/lib/birthDate.ts`, below the existing `clampBirth`, add:

```ts
/** How far ahead a due date may sit. Roughly ten months, comfortably past a
 *  full-term pregnancy while still rejecting a typo like the year 2999. */
const MAX_DUE_DAYS = 300;

/** Local midnight MAX_DUE_DAYS from today. Built with setDate rather than by
 *  adding milliseconds: 300 days of ms crosses a DST boundary in most
 *  timezones and lands at 23:00 or 01:00 instead of midnight. */
function dueCeiling(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + MAX_DUE_DAYS);
  return d.getTime();
}

/** Clamp raw Y/M/D text fields to a valid DUE date. Same rules as clampBirth
 *  (1900 floor, month 1-12, day clamped to that month's length) except the
 *  ceiling: a due date is allowed up to MAX_DUE_DAYS ahead instead of being
 *  pinned to today. Past dates pass through untouched, so an already-overdue
 *  pregnancy keeps its real date rather than being silently rewritten. */
export function clampDueDate(yStr: string, mStr: string, dStr: string): number {
  const now = new Date();
  const maxYear = now.getFullYear() + 2;
  const y = Math.min(maxYear, Math.max(1900, parseInt(yStr, 10) || now.getFullYear()));
  const mo = Math.min(12, Math.max(1, parseInt(mStr, 10) || 1));
  const maxDay = new Date(y, mo, 0).getDate(); // days in month `mo` (1-12)
  const d = Math.min(maxDay, Math.max(1, parseInt(dStr, 10) || 1));
  return Math.min(new Date(y, mo - 1, d).getTime(), dueCeiling());
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/birthDate.test.ts`
Expected: PASS, the 8 existing tests plus 7 new ones.

- [ ] **Step 5: Create the shared date row**

Create `src/components/DateFields.tsx`:

```tsx
import { TextInput, View } from 'react-native';

import { fontFamily } from '@/theme/fonts';
import { useTheme } from '@/theme/useTheme';

/**
 * A DD / MM / YYYY input row. Extracted so the wizard's born and expecting
 * branches and the confirm-birth sheet cannot drift apart.
 *
 * Each input is wrapped in a View that carries the flex sizing, and that is
 * load-bearing: a TextInput left as a DIRECT flex item keeps min-width: auto on
 * react-native-web, which pins it to its intrinsic width (~20 characters) and
 * overflows the row, pushing the year field off screen. Setting minWidth on the
 * TextInput itself does not help, because RNW drops it there. This bug shipped
 * once already. Keeping the workaround in one component is the point.
 */
export function DateFields({
  day,
  month,
  year,
  onDay,
  onMonth,
  onYear,
}: {
  day: string;
  month: string;
  year: string;
  onDay: (v: string) => void;
  onMonth: (v: string) => void;
  onYear: (v: string) => void;
}) {
  const t = useTheme();

  const field = {
    height: 54,
    borderRadius: 15,
    backgroundColor: t.surface,
    borderWidth: 1.5,
    borderColor: t.line2,
    paddingHorizontal: 16,
    fontSize: 15.5,
    fontFamily: fontFamily(500),
    color: t.text,
    width: '100%',
    textAlign: 'center',
  } as const;

  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <TextInput
          value={day}
          onChangeText={onDay}
          placeholder="DD"
          placeholderTextColor={t.faint}
          keyboardType="number-pad"
          maxLength={2}
          style={field}
        />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <TextInput
          value={month}
          onChangeText={onMonth}
          placeholder="MM"
          placeholderTextColor={t.faint}
          keyboardType="number-pad"
          maxLength={2}
          style={field}
        />
      </View>
      <View style={{ flex: 1.4, minWidth: 0 }}>
        <TextInput
          value={year}
          onChangeText={onYear}
          placeholder="YYYY"
          placeholderTextColor={t.faint}
          keyboardType="number-pad"
          maxLength={4}
          style={field}
        />
      </View>
    </View>
  );
}
```

- [ ] **Step 6: Point the wizard's born branch at it**

In `src/app/setup/baby.tsx`, add the import:

```ts
import { DateFields } from '@/components/DateFields';
```

Then in the `'form'` (born) step, replace the entire existing date row, the `<View style={{ flexDirection: 'row', gap: 10 }}>` block containing the three wrapper Views and their TextInputs, with:

```tsx
            <DateFields
              day={day}
              month={month}
              year={year}
              onDay={setDay}
              onMonth={setMonth}
              onYear={setYear}
            />
```

Leave the `BIRTHDAY` label above it alone. The local `input` style object is still used by the FIRST NAME and LAST NAME fields, so do NOT delete it. Confirm with `grep -n "input" src/app/setup/baby.tsx` that it still has consumers; if it does not, delete it.

- [ ] **Step 7: Verify the row still renders identically**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: no type errors, all tests pass, lint clean apart from the two known pre-existing problems.

This step is a pure refactor: the markup DateFields produces is character-equivalent to what it replaced. If `tsc` complains about the `style={field}` cast, the `as const` on the style object is missing.

- [ ] **Step 8: Commit**

```bash
git add src/lib/birthDate.ts src/lib/birthDate.test.ts src/components/DateFields.tsx src/app/setup/baby.tsx
git commit -m "feat(expecting): clampDueDate plus a shared DD/MM/YYYY row"
```

---

### Task 3: Hold expected children back from sync

An expected child carries a future `birth`, which Baby Buddy's `birth_date` cannot legitimately hold. Two of the three guards live in the pure sync module and are directly testable.

**Files:**
- Modify: `src/data/sync.ts` (`uploadUnsynced` around lines 47-70, and `matchServerChild` around lines 117-129)
- Modify: `src/data/sync.test.ts`

**Interfaces:**
- Consumes: `Child.expected` (Task 1).
- Produces: no new exports. Behaviour change only.

- [ ] **Step 1: Write the failing tests**

Append to `src/data/sync.test.ts`. Reuse whatever local child factory the file already defines; if it has none, build children inline as full `Child` objects. The tests must assert BOTH that an expected child is not pushed AND that it is excluded from the progress total, since a stale total makes the progress bar wrong.

```ts
describe('expected children are held back from the server', () => {
  const kid = (over: Partial<Child> = {}): Child => ({
    id: 'c1',
    first: 'Rowan',
    last: '',
    birth: Date.parse('2026-01-01'),
    color: '#E8A87C',
    ...over,
  });

  it('never pushes an expected child', async () => {
    const pushed: Child[] = [];
    const deps = {
      pushChild: async (c: Child) => {
        pushed.push(c);
        return 99;
      },
      pushEntry: async () => undefined,
      pushMeasurement: async () => undefined,
    } as unknown as UploadDeps;

    await uploadUnsynced(
      {
        children: [kid({ id: 'born' }), kid({ id: 'unborn', expected: true })],
        entries: [],
        measurements: [],
      },
      deps,
    );

    expect(pushed.map((c) => c.id)).toEqual(['born']);
  });

  it('excludes expected children from the progress total', async () => {
    const seen: [number, number][] = [];
    const deps = {
      pushChild: async () => 99,
      pushEntry: async () => undefined,
      pushMeasurement: async () => undefined,
    } as unknown as UploadDeps;

    await uploadUnsynced(
      {
        children: [kid({ id: 'born' }), kid({ id: 'unborn', expected: true })],
        entries: [],
        measurements: [],
      },
      deps,
      (done, total) => seen.push([done, total]),
    );

    expect(seen.every(([, total]) => total === 1)).toBe(true);
  });

  it('leaves the expected child untouched in the returned state', async () => {
    const deps = {
      pushChild: async () => 99,
      pushEntry: async () => undefined,
      pushMeasurement: async () => undefined,
    } as unknown as UploadDeps;

    const out = await uploadUnsynced(
      { children: [kid({ id: 'unborn', expected: true })], entries: [], measurements: [] },
      deps,
    );

    expect(out.children[0].serverId).toBeUndefined();
    expect(out.children[0].expected).toBe(true);
  });

  it('never matches an expected child to a server child', () => {
    const local = kid({ expected: true });
    const server = [kid({ serverId: 7 })];
    expect(matchServerChild(local, server)).toBeNull();
  });

  it('still matches a born child with the same name and birthday', () => {
    const local = kid();
    const server = [kid({ serverId: 7 })];
    expect(matchServerChild(local, server)).toBe(7);
  });
});
```

Make sure `Child`, `UploadDeps`, `uploadUnsynced` and `matchServerChild` are all imported at the top of the file; add whichever are missing.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/data/sync.test.ts`
Expected: FAIL. The push and total assertions fail because expected children are currently treated like any other.

- [ ] **Step 3: Exclude expected children from the upload**

In `src/data/sync.ts`, change the `total` computation so the children term skips expected children:

```ts
  const total =
    children.filter((c) => c.serverId == null && !c.expected).length +
    entries.filter((e) => e.serverId == null).length +
    measurements.filter((m) => m.serverId == null).length;
```

Then in the "1. Children first." loop, change the guard line:

```ts
  for (const child of children) {
    if (child.serverId != null) continue;
```

to:

```ts
  // An expected child holds a DUE date in `birth`, which is not a valid
  // birth_date for the server. It stays local until confirmBirth releases it.
  for (const child of children) {
    if (child.serverId != null || child.expected) continue;
```

Leave the rest of the function alone. An expected child simply never gets a `serverId`, so the existing `childIdMap` step skips it and any entry belonging to it is skipped exactly like an entry under any other unsynced child.

- [ ] **Step 4: Exclude expected children from matching**

In `matchServerChild`, add a guard as the first statement of the function body, above the `norm` helper:

```ts
  // An expected child must not adopt a server row: its `birth` is a due date,
  // so a name-and-birthday match would be a coincidence, not the same child.
  if (local.expected) return null;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/data/sync.test.ts`
Expected: PASS, including the pre-existing tests in that file.

- [ ] **Step 6: Typecheck and full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/data/sync.ts src/data/sync.test.ts
git commit -m "feat(expecting): hold expected children back from server sync"
```

---

### Task 4: Store support, creating and confirming

The third sync guard plus the state transition. Both live in the store because two different screens can trigger the transition and it must have one implementation.

**Files:**
- Modify: `src/store/useAppStore.ts` (the `saveChild` type at ~line 222, its create branch at ~1088-1135, and a new `confirmBirth` action)
- Modify: `src/store/useAppStore.test.ts`

**Interfaces:**
- Consumes: `Child.expected` (Task 1).
- Produces:
  - `saveChild(fields: { first: string; last: string; birth: number; expected?: boolean; photo?: PhotoChange }): void` (the `expected` field is new)
  - `confirmBirth(id: string, birth: number): void`

  Tasks 6, 8 and 9 use these.

- [ ] **Step 1: Write the failing tests**

Append to `src/store/useAppStore.test.ts`, following whatever store-reset helper the file already uses in its other describe blocks.

```ts
describe('expecting children', () => {
  it('creates an expected child carrying the flag, and selects it', () => {
    useAppStore.setState({ children: [], selectedChildId: '', connection: { mode: 'local' } });
    useAppStore.getState().saveChild({ first: 'Rowan', last: '', birth: Date.parse('2026-12-01'), expected: true });

    const kids = useAppStore.getState().children;
    expect(kids).toHaveLength(1);
    expect(kids[0].expected).toBe(true);
    expect(kids[0].serverId).toBeUndefined();
    expect(useAppStore.getState().selectedChildId).toBe(kids[0].id);
  });

  it('creates a born child with no expected flag', () => {
    useAppStore.setState({ children: [], selectedChildId: '', connection: { mode: 'local' } });
    useAppStore.getState().saveChild({ first: 'Wren', last: '', birth: Date.parse('2026-01-05') });
    expect(useAppStore.getState().children[0].expected).toBeUndefined();
  });

  it('confirmBirth clears the flag and sets the real birth date', () => {
    useAppStore.setState({ children: [], selectedChildId: '', connection: { mode: 'local' } });
    useAppStore.getState().saveChild({ first: 'Rowan', last: '', birth: Date.parse('2026-12-01'), expected: true });
    const id = useAppStore.getState().children[0].id;

    const actual = Date.parse('2026-11-24');
    useAppStore.getState().confirmBirth(id, actual);

    const kid = useAppStore.getState().children[0];
    expect(kid.expected).toBe(false);
    expect(kid.birth).toBe(actual);
  });

  it('leaves the confirmed child sync-eligible', () => {
    useAppStore.setState({ children: [], selectedChildId: '', connection: { mode: 'local' } });
    useAppStore.getState().saveChild({ first: 'Rowan', last: '', birth: Date.parse('2026-12-01'), expected: true });
    const id = useAppStore.getState().children[0].id;
    useAppStore.getState().confirmBirth(id, Date.parse('2026-11-24'));

    const kid = useAppStore.getState().children[0];
    expect(kid.serverId).toBeUndefined(); // still unsynced, so the reconnect flush picks it up
    expect(kid.expected).toBe(false); // and no longer held back
  });

  it('confirmBirth on an unknown id is a no-op', () => {
    useAppStore.setState({ children: [], selectedChildId: '', connection: { mode: 'local' } });
    useAppStore.getState().saveChild({ first: 'Rowan', last: '', birth: Date.parse('2026-12-01'), expected: true });
    const before = useAppStore.getState().children;
    useAppStore.getState().confirmBirth('nope', Date.now());
    expect(useAppStore.getState().children).toEqual(before);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/store/useAppStore.test.ts`
Expected: FAIL, `confirmBirth` is not a function and `expected` is not accepted by `saveChild`.

- [ ] **Step 3: Widen the `saveChild` signature and declare `confirmBirth`**

In the store's state interface, change the `saveChild` declaration (currently around line 222) to:

```ts
  saveChild: (fields: { first: string; last: string; birth: number; expected?: boolean; photo?: PhotoChange }) => void;
  /** Turn an expected child into a born one: clear the flag, set the real birth
   *  date, and release it for sync. The single implementation of that
   *  transition, shared by Home's confirm sheet and the child sheet's toggle. */
  confirmBirth: (id: string, birth: number) => void;
```

- [ ] **Step 4: Carry the flag through creation and skip the push**

In `saveChild`'s create branch, add `expected` to the constructed child. The object becomes:

```ts
    const localId = 'child' + Date.now();
    const child: Child = {
      id: localId,
      first: fields.first,
      last: fields.last,
      birth: fields.birth,
      expected: fields.expected,
      color: childColor(s.children.length),
      picture: change.kind === 'set' ? change.photo.uri : null,
    };
```

Then change the server-push condition below it so an expected child is never pushed. It currently reads:

```ts
    const conn = s.connection;
    if (conn && conn.mode === 'server' && !s.offline) {
```

Change it to:

```ts
    const conn = s.connection;
    // An expected child holds a DUE date in `birth`, which the server's
    // birth_date cannot legitimately hold. confirmBirth releases it later.
    if (conn && conn.mode === 'server' && !s.offline && !fields.expected) {
```

Leave the whole `.then(...)` body untouched.

- [ ] **Step 5: Implement `confirmBirth`**

Add this action immediately after `saveChild` in the store implementation:

```ts
  confirmBirth: (id, birth) => {
    const s = get();
    const child = s.children.find((c) => c.id === id);
    if (!child || !child.expected) return;
    set({
      children: s.children.map((c) => (c.id === id ? { ...c, expected: false, birth } : c)),
    });
    get().showToast('Welcome to the world');
    // Deliberately no direct push here. The child is now an ordinary unsynced
    // local child (serverId == null, expected false), so the existing reconnect
    // flush and uploadUnsynced pick it up with no special casing.
  },
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/store/useAppStore.test.ts`
Expected: PASS, including every pre-existing test in that file.

- [ ] **Step 7: Typecheck and full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/store/useAppStore.ts src/store/useAppStore.test.ts
git commit -m "feat(expecting): create expected children, confirmBirth transition"
```

---

### Task 5: Show the countdown everywhere the age appears

Four sites render an age today. All four switch to the one helper, so the countdown can never appear in three places and an age in the fourth.

**Files:**
- Modify: `src/app/(tabs)/index.tsx:207`
- Modify: `src/shell/Sidebar.tsx:139`
- Modify: `src/features/childSwitcher/ChildSwitcher.tsx:64`
- Modify: `src/widgets/snapshot.ts` (the returned object, around line 80)
- Modify: `src/widgets/StatusWidget.tsx:69`

**Interfaces:**
- Consumes: `ageOrDueLabel` (Task 1), `Child.expected` (Task 1).
- Produces: `WidgetSnapshot.expected: boolean`.

- [ ] **Step 1: Home header**

In `src/app/(tabs)/index.tsx`, replace the age line (currently line 207):

```tsx
              {child ? ageStr(child.birth, now) : ''}
```

with:

```tsx
              {child ? ageOrDueLabel(child.birth, !!child.expected, now) : ''}
```

Update the import from `@/lib/format`: replace `ageStr` with `ageOrDueLabel` if `ageStr` is now unused in the file, otherwise add `ageOrDueLabel` alongside it. Check with `grep -n "ageStr" "src/app/(tabs)/index.tsx"` after editing.

- [ ] **Step 2: Desktop sidebar**

In `src/shell/Sidebar.tsx`, replace the age line (currently line 139):

```tsx
            {child ? ageStr(child.birth, now) : ''}
```

with:

```tsx
            {child ? ageOrDueLabel(child.birth, !!child.expected, now) : ''}
```

and fix the `@/lib/format` import the same way.

- [ ] **Step 3: Child switcher rows**

In `src/features/childSwitcher/ChildSwitcher.tsx`, replace the age line (currently line 64):

```tsx
                  {ageStr(c.birth, now)}
```

with:

```tsx
                  {ageOrDueLabel(c.birth, !!c.expected, now)}
```

and fix the `@/lib/format` import the same way.

- [ ] **Step 4: Widget snapshot**

In `src/widgets/snapshot.ts`, in the returned object, add an `expected` field directly after the existing `birth` line:

```ts
    birth: child?.birth ?? null,
    expected: !!child?.expected,
```

If the module declares a `WidgetSnapshot` type locally, add `expected: boolean;` to it. If the type lives elsewhere, find it with `grep -rn "WidgetSnapshot" src --include=*.ts --include=*.tsx` and add the field there.

- [ ] **Step 5: Android status widget**

In `src/widgets/StatusWidget.tsx`, replace the age line (currently line 69):

```tsx
  const age = s?.birth != null ? ageStr(s.birth, now) : '';
```

with:

```tsx
  const age = s?.birth != null ? ageOrDueLabel(s.birth, s.expected, now) : '';
```

and fix its `@/lib/format` import the same way.

- [ ] **Step 6: Confirm no stale call sites remain**

Run: `grep -rn "ageStr(" src --include="*.ts" --include="*.tsx" | grep -v "format.ts" | grep -v test`
Expected: no output. Every display site now goes through `ageOrDueLabel`. `ageStr` itself stays exported and is still called by `ageOrDueLabel`.

- [ ] **Step 7: Typecheck, lint, full suite**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: no type errors, all tests pass, and lint clean apart from the two known pre-existing problems listed in Global Constraints.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(tabs)/index.tsx" src/shell/Sidebar.tsx src/features/childSwitcher/ChildSwitcher.tsx src/widgets/snapshot.ts src/widgets/StatusWidget.tsx
git commit -m "feat(expecting): countdown in place of age at every display site"
```

---

### Task 6: Home while expecting

Logging a feed against an unborn baby is meaningless, so the tiles are replaced rather than merely discouraged. `DashboardContent` already early-returns `NoChildCard`; this is the same pattern one line further on, which is what gets phone and desktop from a single change.

**Files:**
- Create: `src/features/dashboard/ExpectingCard.tsx`
- Create: `src/features/dashboard/ConfirmBirthSheet.tsx`
- Modify: `src/features/dashboard/DashboardContent.tsx` (imports, the selector block at ~48-58, the early return)
- Modify: `src/app/_layout.tsx` (mount the sheet beside the existing `ChildSheet`)
- Modify: `src/store/useAppStore.ts` (a `confirmBirthFor` piece of UI state)

**Interfaces:**
- Consumes: `confirmBirth` (Task 4), `ageOrDueLabel` (Task 1), `DateFields` (Task 2), `clampBirth` from `@/lib/birthDate`.
- Produces: `ExpectingCard`, `ConfirmBirthSheet`, and store state `confirmBirthFor: string | null` with actions `openConfirmBirth(id: string)` and `closeConfirmBirth()`.

- [ ] **Step 1: Add the sheet's UI state to the store**

In the store's state interface, beside the other sheet flags (near `childSheet` around line 121), add:

```ts
  /** id of the expected child whose birth is being confirmed, or null */
  confirmBirthFor: string | null;
```

and beside the other sheet actions:

```ts
  openConfirmBirth: (id: string) => void;
  closeConfirmBirth: () => void;
```

In the initial state, beside `childSheet: false`, add:

```ts
  confirmBirthFor: null,
```

and in the implementation, beside `closeChildSheet`, add:

```ts
  openConfirmBirth: (id) => set({ confirmBirthFor: id }),
  closeConfirmBirth: () => set({ confirmBirthFor: null }),
```

- [ ] **Step 2: Create the expecting card**

Create `src/features/dashboard/ExpectingCard.tsx`:

```tsx
import { Pressable, View } from 'react-native';

import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { ageOrDueLabel } from '@/lib/format';
import { shadowStyle } from '@/theme/shadow';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';
import type { Child } from '@/types/models';

/**
 * Shown in place of the dashboard while the selected child is still expected.
 * The activity tiles are deliberately absent: a feed or a nap logged against an
 * unborn baby is junk data, and hiding the tiles prevents it rather than just
 * discouraging it.
 */
export function ExpectingCard({ child }: { child: Child }) {
  const t = useTheme();
  const now = useAppStore((s) => s.now);
  const openConfirmBirth = useAppStore((s) => s.openConfirmBirth);

  return (
    <View
      style={{
        alignItems: 'center',
        paddingVertical: 40,
        paddingHorizontal: 24,
        borderRadius: 20,
        backgroundColor: t.surface,
        borderWidth: 1.5,
        borderColor: t.line2,
      }}
    >
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 18,
          backgroundColor: hexA(t.primary, t.dark ? 0.16 : 0.12),
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="heart" color={t.primary} size={26} />
      </View>

      <Txt weight={800} size={22} tracking={-0.4} style={{ marginTop: 18 }}>
        {ageOrDueLabel(child.birth, true, now)}
      </Txt>
      <Txt weight={500} size={14.5} color={t.dim} style={{ marginTop: 8, textAlign: 'center', lineHeight: 21 }}>
        Everything is ready for {child.first}. Tracking starts the day they arrive.
      </Txt>

      <Pressable
        onPress={() => openConfirmBirth(child.id)}
        accessibilityRole="button"
        style={(s) => [
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            height: 50,
            paddingHorizontal: 22,
            borderRadius: 15,
            marginTop: 22,
            backgroundColor: t.primary,
            cursor: 'pointer',
          },
          shadowStyle(`0px 8px 22px ${hexA(t.primary, 0.35)}`),
          isHovered(s) && { opacity: 0.9 },
        ]}
      >
        <Icon name="heart" color={t.onPrimary} size={18} />
        <Txt unselectable weight={800} size={16} color={t.onPrimary}>
          They have arrived
        </Txt>
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 3: Create the confirm-birth sheet**

Create `src/features/dashboard/ConfirmBirthSheet.tsx`. It collects one date, prefilled with today, because most people confirm on or near the day.

```tsx
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { DateFields } from '@/components/DateFields';
import { isHovered } from '@/components/hover';
import { Txt } from '@/components/Txt';
import { clampBirth } from '@/lib/birthDate';
import { hexA } from '@/lib/color';
import { shadowStyle } from '@/theme/shadow';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

/**
 * One field: the real birth date, prefilled with today. The name already exists
 * from the due-date form, so there is nothing else to ask for. Uses clampBirth
 * (not clampDueDate): this IS a birth date now, so it must not be in the future.
 */
export function ConfirmBirthSheet() {
  const id = useAppStore((s) => s.confirmBirthFor);
  if (!id) return null;
  return <Inner id={id} />;
}

function Inner({ id }: { id: string }) {
  const t = useTheme();
  const close = useAppStore((s) => s.closeConfirmBirth);
  const confirmBirth = useAppStore((s) => s.confirmBirth);
  const child = useAppStore((s) => s.children.find((c) => c.id === id));

  const today = new Date();
  const [year, setYear] = useState(String(today.getFullYear()));
  const [month, setMonth] = useState(String(today.getMonth() + 1));
  const [day, setDay] = useState(String(today.getDate()));
  const [saving, setSaving] = useState(false);

  const onConfirm = () => {
    if (saving) return;
    setSaving(true);
    confirmBirth(id, clampBirth(year, month, day));
    close();
  };

  return (
    <BottomSheet onClose={close}>
      <View style={{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: 20 }}>
        <Txt weight={800} size={21} tracking={-0.3}>
          Welcome, {child?.first ?? 'little one'}
        </Txt>
        <Txt weight={500} size={14.5} color={t.dim} style={{ marginTop: 8, lineHeight: 21 }}>
          What day did they arrive? Everything starts from here.
        </Txt>

        <View style={{ marginTop: 20 }}>
          <DateFields
            day={day}
            month={month}
            year={year}
            onDay={setDay}
            onMonth={setMonth}
            onYear={setYear}
          />
        </View>

        <Pressable
          onPress={onConfirm}
          disabled={saving}
          accessibilityRole="button"
          accessibilityState={{ disabled: saving }}
          style={(s) => [
            {
              height: 54,
              borderRadius: 16,
              marginTop: 22,
              backgroundColor: t.primary,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: saving ? 0.5 : 1,
              cursor: saving ? 'auto' : 'pointer',
            },
            !saving && shadowStyle(`0px 8px 22px ${hexA(t.primary, 0.35)}`),
            !saving && isHovered(s) && { opacity: 0.9 },
          ]}
        >
          <Txt unselectable weight={800} size={17} color={t.onPrimary}>
            Confirm birth
          </Txt>
        </Pressable>
      </View>
    </BottomSheet>
  );
}
```

The date row is `DateFields` (Task 2), not hand-rolled inputs. That component owns the react-native-web workaround for flex-item inputs overflowing their row, a bug that shipped and had to be fixed on the previous branch. Do not inline a replacement here.

- [ ] **Step 4: Mount the sheet**

In `src/app/_layout.tsx`, beside the existing `<ChildSheet />` (around line 107), add:

```tsx
            <ConfirmBirthSheet />
```

and add the import:

```ts
import { ConfirmBirthSheet } from '@/features/dashboard/ConfirmBirthSheet';
```

- [ ] **Step 5: Early-return from `DashboardContent`**

In `src/features/dashboard/DashboardContent.tsx`, add the import beside the existing `NoChildCard` import:

```ts
import { ExpectingCard } from '@/features/dashboard/ExpectingCard';
```

Directly after the existing `hasChild` selector, add:

```ts
  // Returns a store element, not a derived object, so the reference is stable.
  const selectedChild = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId));
```

Then extend the early-return block. It currently reads:

```tsx
  if (!hasChild) return <NoChildCard />;
```

Change it to:

```tsx
  if (!hasChild) return <NoChildCard />;
  if (selectedChild?.expected) return <ExpectingCard child={selectedChild} />;
```

Both returns sit below every hook in `DashboardContent` (its hooks are one block at the top; the `useTheme` further down the file belongs to a different component), so the rules of hooks still hold.

- [ ] **Step 6: Typecheck, lint, full suite**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: no type errors, all tests pass, lint clean apart from the two known pre-existing problems.

- [ ] **Step 7: Commit**

```bash
git add src/features/dashboard/ExpectingCard.tsx src/features/dashboard/ConfirmBirthSheet.tsx src/features/dashboard/DashboardContent.tsx src/app/_layout.tsx src/store/useAppStore.ts
git commit -m "feat(expecting): countdown Home with a confirm-birth sheet"
```

---

### Task 7: Waiting states for the age-keyed views

Growth, Insights and Milestones all key off an age that does not exist yet. Each gets the same short line. The tab bar keeps its shape: removing tabs would make it visibly reshape at the birth, which reads as the app breaking rather than as progress.

**Files:**
- Create: `src/features/dashboard/WaitingForBirth.tsx`
- Modify: `src/app/(tabs)/growth.tsx` (early return before `const body =`, currently line 25)
- Modify: `src/app/(tabs)/insights.tsx` (a guard in the existing `frame(...)` chain near line 217)
- Modify: `src/features/milestones/MilestonesView.tsx` (beside the existing `if (!child)` at line 36)

**Interfaces:**
- Consumes: `Child.expected` (Task 1).
- Produces: `WaitingForBirth({ what }: { what: string })`.

- [ ] **Step 1: Create the shared component**

Create `src/features/dashboard/WaitingForBirth.tsx`:

```tsx
import { View } from 'react-native';

import { Txt } from '@/components/Txt';
import { useTheme } from '@/theme/useTheme';

/**
 * Placeholder for the views that key off a child's age while that child is
 * still expected. One component so the three tabs cannot drift apart in copy.
 * `what` names the view, e.g. "Growth charts".
 */
export function WaitingForBirth({ what }: { what: string }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 56, paddingHorizontal: 24, gap: 10 }}>
      <Txt weight={700} size={18}>
        Nothing to show yet
      </Txt>
      <Txt weight={500} size={14} color={t.dim} style={{ textAlign: 'center', maxWidth: 260, lineHeight: 20 }}>
        {what} begin once your baby arrives.
      </Txt>
    </View>
  );
}
```

- [ ] **Step 2: Growth**

In `src/app/(tabs)/growth.tsx`, add the import:

```ts
import { WaitingForBirth } from '@/features/dashboard/WaitingForBirth';
```

Then directly after the last hook (`const openMeasurement = ...`, currently line 23) and BEFORE `const body = (`, insert:

```tsx
  if (child?.expected) return <WaitingForBirth what="Growth charts" />;
```

Every hook in this component sits in the block above that line, so the return is safe.

- [ ] **Step 3: Insights**

In `src/app/(tabs)/insights.tsx`, add the import:

```ts
import { WaitingForBirth } from '@/features/dashboard/WaitingForBirth';
```

Then find the guard chain near the end of the component that begins with the comment "Order matters: a failed load leaves insightsLoaded=false" and its `if (error)`. Insert this line directly ABOVE that comment:

```tsx
  // Before the load guards on purpose: an expected child has nothing to load,
  // so there is no point showing a loading or error state for it.
  if (child?.expected) return frame(<WaitingForBirth what="Insights" />);
```

It must go inside `frame(...)` so the page keeps its normal chrome, and it must sit after every hook, which this position satisfies.

- [ ] **Step 4: Milestones**

In `src/features/milestones/MilestonesView.tsx`, add the import:

```ts
import { WaitingForBirth } from '@/features/dashboard/WaitingForBirth';
```

Then directly BEFORE the existing `if (!child) {` block (currently line 36), insert:

```tsx
  if (child?.expected) return <WaitingForBirth what="Milestones" />;
```

Order matters: the `!child` check must stay reachable, so the expected check goes first and only fires when there IS a child.

- [ ] **Step 5: Typecheck, lint, full suite**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: no type errors, all tests pass, lint clean apart from the two known pre-existing problems.

- [ ] **Step 6: Commit**

```bash
git add src/features/dashboard/WaitingForBirth.tsx "src/app/(tabs)/growth.tsx" "src/app/(tabs)/insights.tsx" src/features/milestones/MilestonesView.tsx
git commit -m "feat(expecting): waiting states for the age-keyed views"
```

---

### Task 8: The wizard collects a due date

`src/app/setup/baby.tsx`'s "Not yet" branch is currently an acknowledgement screen that creates no child. It becomes a real form, mirroring the born branch's layout.

**Files:**
- Modify: `src/app/setup/baby.tsx` (the `'expecting'` step block)

**Interfaces:**
- Consumes: `clampDueDate` (Task 2), `DateFields` (Task 2, already imported into this file by that task), `saveChild` with `expected` (Task 4).
- Produces: nothing.

- [ ] **Step 1: Import the due-date clamp**

In `src/app/setup/baby.tsx`, change the `@/lib/birthDate` import to bring in both:

```ts
import { clampBirth, clampDueDate } from '@/lib/birthDate';
```

- [ ] **Step 2: Add the due-date handler**

Directly after the existing `onAdd`, add:

```tsx
  // Guarded against a double tap for the same reason as onAdd: saveChild returns
  // before its work settles and finish() only schedules the navigation.
  const onAddExpected = () => {
    if (!canSave || saving) return;
    setSaving(true);
    saveChild({
      first: first.trim(),
      last: last.trim(),
      birth: clampDueDate(year, month, day),
      expected: true,
    });
    finish();
  };
```

- [ ] **Step 3: Default the date fields forward when the expecting step opens**

The date fields default to today, which is right for a birthday and wrong for a due date. In the `'ask'` step, change the "Not yet" button's handler so it seeds a sensible default. Replace:

```tsx
            onPress={() => setStep('expecting')}
```

with:

```tsx
            onPress={() => {
              // Default the due date to roughly a month out rather than today,
              // which is a likelier starting point and avoids a countdown that
              // opens on "Due any day now".
              const soon = new Date(Date.now() + 30 * 86400000);
              setYear(String(soon.getFullYear()));
              setMonth(String(soon.getMonth() + 1));
              setDay(String(soon.getDate()));
              setStep('expecting');
            }}
```

- [ ] **Step 4: Replace the acknowledgement with the form**

Replace the entire `{step === 'expecting' && ( ... )}` block with:

```tsx
      {step === 'expecting' && (
        <>
          <Txt weight={800} size={26} tracking={-0.5} style={{ marginTop: 12, lineHeight: 32 }}>
            When are they due?
          </Txt>
          <Txt weight={500} size={15} color={t.dim} style={{ marginTop: 10, lineHeight: 22 }}>
            Budkin will count down, and start tracking the day they arrive.
          </Txt>

          <View style={{ marginTop: 24 }}>
            <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 8 }}>
              FIRST NAME
            </Txt>
            <TextInput
              value={first}
              onChangeText={setFirst}
              placeholder="Rowan"
              placeholderTextColor={t.faint}
              autoCapitalize="words"
              autoCorrect={false}
              style={input}
            />
          </View>

          <View style={{ marginTop: 16 }}>
            <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 8 }}>
              DUE DATE
            </Txt>
            <DateFields
              day={day}
              month={month}
              year={year}
              onDay={setDay}
              onMonth={setMonth}
              onYear={setYear}
            />
          </View>

          <View style={{ flex: 1, minHeight: 24 }} />

          <SetupButton
            label="Add baby"
            onPress={onAddExpected}
            disabled={!canSave || saving}
            style={{ marginTop: 24 }}
          />

          <Pressable
            onPress={finish}
            accessibilityRole="button"
            style={(s) => [{ marginTop: 18, alignItems: 'center', cursor: 'pointer' }, isHovered(s) && { opacity: 0.75 }]}
          >
            <Txt unselectable weight={600} size={13.5} color={t.dim}>
              Skip for now
            </Txt>
          </Pressable>
        </>
      )}
```

`DateFields` is the same component the born branch uses (Task 2), so both branches stay identical by construction and the react-native-web overflow workaround lives in one place. It is already imported in this file by Task 2; do not add a second import.

- [ ] **Step 5: Typecheck, lint, full suite**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: no type errors, all tests pass, lint clean apart from the two known pre-existing problems.

- [ ] **Step 6: Commit**

```bash
git add src/app/setup/baby.tsx
git commit -m "feat(expecting): wizard collects a name and due date"
```

---

### Task 9: The child sheet can add an expecting baby

Without this, a second baby on the way could only be added by wiping the app and redoing onboarding.

**Files:**
- Modify: `src/features/childSwitcher/ChildSheet.tsx` (imports, a new state flag, the date label and section, and `onSave`)

**Interfaces:**
- Consumes: `clampDueDate` (Task 2), `saveChild` with `expected` and `confirmBirth` (Task 4).
- Produces: nothing.

- [ ] **Step 1: Import the due-date clamp**

Change the `@/lib/birthDate` import to:

```ts
import { clampBirth, clampDueDate } from '@/lib/birthDate';
```

- [ ] **Step 2: Track the expecting toggle**

Beside the other `useState` calls (after the `photo`/`photoChange` state, around line 108), add:

```tsx
  const [expecting, setExpecting] = useState(!!editing?.expected);
```

- [ ] **Step 3: Add the toggle above the date section**

The toggle is NOT shown for every child. A born baby cannot become unborn, and allowing that flip would be worse than useless: `saveChild`'s edit branch spreads `...existing` and never reads `fields.expected`, so the flag would silently fail to persist; and if it did persist on an already-synced child it would produce a child that is both `expected` and has a `serverId`, a state the sync guards do not handle (they assume an expected child was never pushed).

So gate it. Add this derivation beside the other locals in `Inner`:

```tsx
  // Shown when creating, and when editing a child who is still expected (so the
  // born direction stays available as a birth confirmation). Never shown for an
  // already-born child: that flip is meaningless and would not persist anyway,
  // since saveChild's edit branch does not carry `expected`.
  const canSetStatus = !editing || !!editing.expected;
```

Then directly ABOVE the existing date-section label (the `<Txt>` reading "Birth date", currently line 216), insert:

```tsx
        {canSetStatus && (
          <>
            <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 9 }}>
              Status
            </Txt>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 18 }}>
              {([
                ['Born', false],
                ['Expecting', true],
              ] as const).map(([label, value]) => (
                <Pressable
                  key={label}
                  onPress={() => setExpecting(value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: expecting === value }}
                  style={(s) => [
                    {
                      flex: 1,
                      height: 44,
                      borderRadius: 13,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: 1.5,
                      borderColor: expecting === value ? t.primary : t.line,
                      backgroundColor: expecting === value ? hexA(t.primary, t.dark ? 0.16 : 0.1) : t.surface,
                      cursor: 'pointer',
                    },
                    isHovered(s) && expecting !== value && { borderColor: t.line2 },
                  ]}
                >
                  <Txt unselectable weight={700} size={14} color={expecting === value ? t.primary : t.text}>
                    {label}
                  </Txt>
                </Pressable>
              ))}
            </View>
          </>
        )}
```

Confirm `hexA` and `isHovered` are already imported in this file. Both are; do not add duplicate imports.

- [ ] **Step 4: Swap the date label**

Replace the date-section label text (currently line 217):

```tsx
          Birth date
```

with:

```tsx
          {expecting ? 'Due date' : 'Birth date'}
```

- [ ] **Step 5: Route the save through the right clamp and transition**

Replace the whole existing `onSave` (currently around lines 135-140) with:

```tsx
  const onSave = () => {
    if (!canSave) return;
    // An already-born child cannot be edited into an expected one (the toggle is
    // hidden for it), so `expecting` is only ever true here when creating or
    // when the child was already expected.
    const stillExpecting = canSetStatus && expecting;
    const date = stillExpecting ? clampDueDate(year, month, day) : clampBirth(year, month, day);
    // Flipping an existing expected child to Born IS a birth confirmation, so it
    // goes through the same store transition Home's confirm sheet uses rather
    // than a second implementation of it.
    if (editing?.expected && !expecting) {
      confirmBirth(editing.id, date);
      close();
      return;
    }
    saveChild({ first: first.trim(), last: last.trim(), birth: date, expected: stillExpecting, photo: photoChange });
  };
```

Add the `confirmBirth` selector beside the other store selectors near the top of `Inner`:

```tsx
  const confirmBirth = useAppStore((s) => s.confirmBirth);
```

- [ ] **Step 6: Typecheck, lint, full suite**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: no type errors, all tests pass, lint clean apart from the two known pre-existing problems.

- [ ] **Step 7: Commit**

```bash
git add src/features/childSwitcher/ChildSheet.tsx
git commit -m "feat(expecting): born or expecting toggle in the child sheet"
```

---

### Task 10: Drive the whole arc on web

The unit tests cover the logic; none of them can tell you whether the countdown reads well or the tiles actually disappear.

**Files:** none modified. This task verifies Tasks 1 through 9.

- [ ] **Step 1: Start the web build with a cleared cache**

Run: `CI=1 npx expo start --web --port 8081 --clear`

`--clear` is REQUIRED, not optional. Metro's on-disk cache survives a plain restart and will serve stale modules, which on the previous branch produced a full round of phantom test failures against fixes that were already correct.

Do NOT try to confirm bundle freshness by grepping the served bundle for a local identifier. The React Compiler renames locals, so the name will not appear even in a fresh bundle. Verify by driving behaviour.

- [ ] **Step 2: Drive the expecting arc with headless Playwright**

Launch Chromium with `--no-sandbox`, and neutralise the dev-only LogBox overlay first, since it swallows pointer events over the bottom of the screen:

```js
await page.addStyleTag({ content: '#error-toast{display:none !important;pointer-events:none !important;}' });
```

From a fresh browser context:

1. `/` lands on the welcome step. Tap "Just use this device".
2. Tap "Not yet". The screen now asks "When are they due?" with a name field and a DD/MM/YYYY row.
3. **Check the date row does not overflow**: measure all three inputs and assert their right edge is within the container. This is the exact bug that shipped on the previous branch.
4. Type a first name, leave the prefilled date, tap "Add baby".
5. Home shows the countdown (matching `/^Due (in|tomorrow|any day now)/`) and **no** activity tiles.
6. The child switcher row and, at desktop width, the sidebar show the same countdown.

- [ ] **Step 3: Check the waiting states**

From that same state, visit Growth, Insights and Milestones. Each shows "Nothing to show yet". Confirm the tab bar still has all six tabs. Visit Notes and confirm it is usable, not blocked.

- [ ] **Step 4: Confirm the birth**

Back on Home, tap "They have arrived". The sheet opens prefilled with today. Confirm it, then check:

1. Home now renders the activity tiles, not the expecting card.
2. The header shows an age (matching `/days old|weeks old|months old/`), not a countdown.
3. Growth, Insights and Milestones no longer show the waiting state.

- [ ] **Step 5: Check the child sheet path**

Open the child switcher, add a child, and confirm the Born/Expecting toggle appears and that choosing Expecting relabels the date field to "Due date". Save an expecting child and confirm the switcher lists it with a countdown.

- [ ] **Step 6: Check no console errors**

Across every scenario, assert there is no "Maximum update depth exceeded" (the zustand v5 selector failure mode). Ignore the known pre-existing "React does not recognize the `%s` prop" warning.

- [ ] **Step 7: Commit anything the run turned up**

If the run required fixes, commit them against the task they belong to. If it did not, the branch is ready.

---

## Notes for the implementer

- **`expected` is optional on `Child`.** Never assume it is present: read it as `!!child.expected` or `child?.expected`.
- **`birth` means two different things.** When `expected` is true it is a DUE date. This is why display goes through `ageOrDueLabel` and never through a bare `ageStr`, and why `clampDueDate` exists separately from `clampBirth`.
- **The sync guards are the safety-critical part.** An expected child reaching Baby Buddy writes an invalid `birth_date` to someone's real server. Three guards cover it: `saveChild`'s push condition, `uploadUnsynced`'s loop and total, and `matchServerChild`.
- **Out of scope**, and it should stay that way: due-date notifications or reminders, pregnancy tracking (appointments, kick counts, weight), and any change to Baby Buddy's own data model.
