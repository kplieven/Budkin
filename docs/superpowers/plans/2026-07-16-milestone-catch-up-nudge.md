# Milestone Catch-Up Nudge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a home-screen nudge that asks, once, whether the baby has already reached each milestone whose typical window has passed and that is not yet logged.

**Architecture:** A pure selector computes the eligible milestone list from age, a child-scoped reached map, and a per-child answered set. A small AsyncStorage module and a store slice persist the answered set. A presentational component renders one eligible milestone at a time on the dashboard and wires the three actions (Yes routes to the existing milestone sheet; any action retires the prompt).

**Tech Stack:** Expo v56, React Native 0.85, expo-router, zustand v5, vitest (node env), AsyncStorage.

## Global Constraints

- Read the exact versioned Expo docs at https://docs.expo.dev/versions/v56.0.0/ before writing framework code.
- zustand v5 rule: NEVER return a freshly-created ref (inline `.filter`/`.map`/object/array) from a `useAppStore(selector)`. Select raw state, derive in render. Use a module-level `const EMPTY: string[] = []` for stable empty fallbacks. Violating this blanks web routes with "Maximum update depth exceeded".
- No em-dashes anywhere: code comments, UI copy, commit messages. Use commas, colons, or separate sentences.
- Test runner: `npm test` (runs `vitest run`). Typecheck: `npx tsc --noEmit`. Lint: `npm run lint`.
- vitest environment is `node`. There is NO React Native render harness and no component tests in this repo. Test pure logic and store actions only. Mock IO modules per test file with `vi.mock` + `vi.hoisted` in-memory stores (see `src/data/servers.test.ts`).
- Every commit message ends with these two trailer lines exactly:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01FT9riTv78aYLnfdmiD7CoW`
- Work on branch `feature/milestone-catch-up-nudge`. Do not switch branches.

## File Structure

- `src/lib/milestones.ts` (modify): add pure `overdueUnlogged` selector and `reachedForChild` helper alongside the existing catalog helpers.
- `src/lib/milestones.test.ts` (modify): add tests for the two new functions.
- `src/data/milestonePrompts.ts` (create): AsyncStorage load/save of the per-child answered-key map. Mirrors `src/data/prefs.ts` / `src/data/timers.ts`.
- `src/data/milestonePrompts.test.ts` (create): round-trip test with AsyncStorage mocked in-memory.
- `src/store/useAppStore.ts` (modify): new `answeredMilestonePrompts` state, `answerMilestonePrompt` action, hydrate load, import.
- `src/store/useAppStore.test.ts` (modify): mock the new IO module, reset it in `beforeEach`, add an action test.
- `src/features/milestones/MilestonesView.tsx` (modify): scope reached-detection to the selected child (bug fix).
- `src/features/milestones/MilestoneNudge.tsx` (create): the dashboard card.
- `src/features/dashboard/DashboardContent.tsx` (modify): render `<MilestoneNudge />` at the top.

---

### Task 1: Pure selectors in `src/lib/milestones.ts`

**Files:**
- Modify: `src/lib/milestones.ts` (add two exports after `aroundNow`, around line 84)
- Test: `src/lib/milestones.test.ts`

**Interfaces:**
- Consumes: existing `MILESTONES`, `MilestoneDef`, `reachedByKey`, and the `Entry` / `MilestoneEntry` types.
- Produces:
  - `overdueUnlogged(ageMonths: number | null, reached: Map<string, MilestoneEntry>, answered: readonly string[]): MilestoneDef[]`
  - `reachedForChild(entries: Entry[], childId: string | undefined): Map<string, MilestoneEntry>`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/milestones.test.ts`. The existing `ms(key, time)` helper (top of file) builds a `MilestoneEntry` with `childId: '5'`; add a second helper for a different child inline where needed.

```ts
describe('reachedForChild', () => {
  it('counts only the given child\'s milestone entries', () => {
    const forA: Entry = { id: 'a1', childId: 'A', type: 'milestone', key: 'rolls-over', time: 1, text: 'x', tags: [] };
    const forB: Entry = { id: 'b1', childId: 'B', type: 'milestone', key: 'crawls', time: 1, text: 'x', tags: [] };
    const mapA = reachedForChild([forA, forB], 'A');
    expect(mapA.has('rolls-over')).toBe(true);
    expect(mapA.has('crawls')).toBe(false); // child B's milestone does not count for A
  });

  it('returns an empty map when childId is undefined', () => {
    const forA: Entry = { id: 'a1', childId: 'A', type: 'milestone', key: 'rolls-over', time: 1, text: 'x', tags: [] };
    expect(reachedForChild([forA], undefined).size).toBe(0);
  });
});

describe('overdueUnlogged', () => {
  const noneReached = new Map<string, MilestoneEntry>();

  it('returns empty when age is unknown', () => {
    expect(overdueUnlogged(null, noneReached, [])).toEqual([]);
  });

  it('includes a milestone strictly past its maxMonths, unlogged and unanswered', () => {
    // waves-bye is 9-12 months. At 13 months it is past the window.
    const keys = overdueUnlogged(13, noneReached, []).map((d) => d.key);
    expect(keys).toContain('waves-bye');
  });

  it('excludes a milestone still within its window (age == maxMonths)', () => {
    // waves-bye maxMonths is 12; at exactly 12 it is still "around now", not overdue.
    const keys = overdueUnlogged(12, noneReached, []).map((d) => d.key);
    expect(keys).not.toContain('waves-bye');
  });

  it('excludes a logged milestone', () => {
    const reached = reachedByKey([ms('waves-bye', 1)]);
    const keys = overdueUnlogged(13, reached, []).map((d) => d.key);
    expect(keys).not.toContain('waves-bye');
  });

  it('excludes an answered milestone', () => {
    const keys = overdueUnlogged(13, noneReached, ['waves-bye']).map((d) => d.key);
    expect(keys).not.toContain('waves-bye');
  });

  it('sorts by maxMonths ascending (longest-overdue first)', () => {
    // At 60 months many are overdue; the result must be ascending by maxMonths.
    const out = overdueUnlogged(60, noneReached, []);
    const maxes = out.map((d) => d.maxMonths);
    expect(maxes).toEqual([...maxes].sort((a, b) => a - b));
  });
});
```

Also add `reachedForChild` and `overdueUnlogged` to the import at the top of the test file:
```ts
import { MILESTONES, MILESTONE_BY_KEY, aroundNow, groupByCategory, overdueUnlogged, reachedByKey, reachedForChild } from '@/lib/milestones';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/milestones.test.ts`
Expected: FAIL with "overdueUnlogged is not a function" / "reachedForChild is not a function".

- [ ] **Step 3: Implement the two functions**

In `src/lib/milestones.ts`, add after `aroundNow` (after line 84, before `groupByCategory`):

```ts
/** Reached-milestone map scoped to one child. In local mode `entries` holds
 *  every child's history, so filter by childId first (server mode already loads
 *  only the selected child, so the filter is a harmless no-op there). Empty when
 *  childId is undefined. */
export function reachedForChild(entries: Entry[], childId: string | undefined): Map<string, MilestoneEntry> {
  if (!childId) return new Map();
  return reachedByKey(entries.filter((e) => e.childId === childId));
}

/** Not-yet-reached, not-yet-answered milestones whose typical window has fully
 *  passed (age strictly greater than maxMonths), sorted longest-overdue first
 *  (ascending maxMonths). Empty when age is unknown. Hands off cleanly from
 *  aroundNow, which covers minMonths..maxMonths inclusive. */
export function overdueUnlogged(
  ageMonths: number | null,
  reached: Map<string, MilestoneEntry>,
  answered: readonly string[],
): MilestoneDef[] {
  if (ageMonths == null) return [];
  return MILESTONES.filter(
    (m) => ageMonths > m.maxMonths && !reached.has(m.key) && !answered.includes(m.key),
  ).sort((a, b) => a.maxMonths - b.maxMonths);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/milestones.test.ts`
Expected: PASS (all existing + new cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/milestones.ts src/lib/milestones.test.ts
git commit -m "feat(milestones): overdueUnlogged and reachedForChild selectors"   # remember the two trailer lines
```

---

### Task 2: Persistence module `src/data/milestonePrompts.ts`

**Files:**
- Create: `src/data/milestonePrompts.ts`
- Test: `src/data/milestonePrompts.test.ts`

**Interfaces:**
- Produces:
  - `loadMilestonePrompts(): Promise<Record<string, string[]>>`
  - `saveMilestonePrompts(map: Record<string, string[]>): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `src/data/milestonePrompts.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadMilestonePrompts, saveMilestonePrompts } from '@/data/milestonePrompts';

// In-memory stand-in for AsyncStorage (node env has no native module).
const mem = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => mem.store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      mem.store.set(k, v);
    }),
  },
}));

beforeEach(() => {
  mem.store.clear();
});

describe('milestonePrompts persistence', () => {
  it('returns an empty map when nothing is stored', async () => {
    expect(await loadMilestonePrompts()).toEqual({});
  });

  it('round-trips the per-child answered map', async () => {
    await saveMilestonePrompts({ c1: ['waves-bye', 'first-word'], c2: ['crawls'] });
    expect(await loadMilestonePrompts()).toEqual({ c1: ['waves-bye', 'first-word'], c2: ['crawls'] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/milestonePrompts.test.ts`
Expected: FAIL (cannot resolve `@/data/milestonePrompts`).

- [ ] **Step 3: Implement the module**

Create `src/data/milestonePrompts.ts`:

```ts
/**
 * Persisted on-device record of which milestone catch-up prompts the user has
 * answered, per child. Backed by AsyncStorage, mirroring src/data/prefs.ts and
 * src/data/timers.ts. Shape: { [childId]: string[] } where each string is a
 * milestone catalog key the user has answered (Yes, Not yet, or dismissed).
 * This is what makes the nudge one-and-done across app restarts.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'babybuddy.milestonePrompts.v1';

export async function loadMilestonePrompts(): Promise<Record<string, string[]>> {
  try {
    const s = await AsyncStorage.getItem(KEY);
    if (!s) return {};
    return JSON.parse(s) as Record<string, string[]>;
  } catch (e) {
    console.warn('[milestonePrompts] loadMilestonePrompts failed:', e);
    return {};
  }
}

export async function saveMilestonePrompts(map: Record<string, string[]>): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(map));
  } catch (e) {
    console.warn('[milestonePrompts] saveMilestonePrompts failed:', e);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/milestonePrompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/milestonePrompts.ts src/data/milestonePrompts.test.ts
git commit -m "feat(milestones): persist answered prompts per child"   # remember the two trailer lines
```

---

### Task 3: Store slice `answeredMilestonePrompts` + `answerMilestonePrompt`

**Files:**
- Modify: `src/store/useAppStore.ts` (interface ~line 134/236, import ~line 56, initial state ~line 467, hydrate ~line 546, action near `openMilestone` ~line 1483)
- Test: `src/store/useAppStore.test.ts` (hoisted `h` ~line 55, a `vi.mock` block ~line 123, `beforeEach` ~line 262/277, a new `describe`)

**Interfaces:**
- Consumes: `loadMilestonePrompts`, `saveMilestonePrompts` from Task 2.
- Produces:
  - State: `answeredMilestonePrompts: Record<string, string[]>`
  - Action: `answerMilestonePrompt: (key: string) => void`

- [ ] **Step 1: Write the failing test**

In `src/store/useAppStore.test.ts`:

(a) Add a mock for the new module. Place it next to the existing `vi.mock('@/data/prefs', ...)` block (after line 123):

```ts
vi.mock('@/data/milestonePrompts', () => ({
  loadMilestonePrompts: vi.fn(async () => h.milestonePrompts),
  saveMilestonePrompts: vi.fn(async (m: Record<string, string[]>) => {
    h.milestonePrompts = m;
  }),
}));
```

(b) Add `milestonePrompts` to the hoisted `h` object (inside the `vi.hoisted(() => ({ ... }))` at line 30, e.g. after `prefs`):

```ts
  milestonePrompts: {} as Record<string, string[]>,
```

(c) Reset it in `beforeEach` (near `h.prefs = {};` around line 262) and include it in the baseline `setState` (near `milestoneSheet: null,` around line 289):

```ts
  h.milestonePrompts = {};
```
```ts
    answeredMilestonePrompts: {},
```

(d) Add the test (place near other action tests, e.g. after the milestone-related describes):

```ts
describe('answerMilestonePrompt', () => {
  it('appends per selected child and is idempotent', () => {
    useAppStore.setState({ selectedChildId: 'c1', answeredMilestonePrompts: {} });
    s().answerMilestonePrompt('waves-bye');
    expect(s().answeredMilestonePrompts.c1).toEqual(['waves-bye']);
    s().answerMilestonePrompt('waves-bye'); // one prompt per milestone: no duplicate
    expect(s().answeredMilestonePrompts.c1).toEqual(['waves-bye']);
    s().answerMilestonePrompt('first-word');
    expect(s().answeredMilestonePrompts.c1).toEqual(['waves-bye', 'first-word']);
  });

  it('does not touch another child\'s answered set', () => {
    useAppStore.setState({ selectedChildId: 'c1', answeredMilestonePrompts: { c2: ['crawls'] } });
    s().answerMilestonePrompt('waves-bye');
    expect(s().answeredMilestonePrompts).toEqual({ c2: ['crawls'], c1: ['waves-bye'] });
  });

  it('no-ops when no child is selected', () => {
    useAppStore.setState({ selectedChildId: '', answeredMilestonePrompts: {} });
    s().answerMilestonePrompt('waves-bye');
    expect(s().answeredMilestonePrompts).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/useAppStore.test.ts -t answerMilestonePrompt`
Expected: FAIL ("answerMilestonePrompt is not a function").

- [ ] **Step 3: Implement the store changes**

(a) Import (add near line 56, next to the prefs import):
```ts
import { loadMilestonePrompts, saveMilestonePrompts } from '@/data/milestonePrompts';
```

(b) Interface state field. In the `interface AppStore` data block, after `milestoneSheet` (line 134) or near `selectedChildId` (line 137), add:
```ts
  /** Milestone catch-up prompts the user has answered, per child id. One prompt
   *  per milestone: any answer (Yes, Not yet, dismiss) adds the key here so the
   *  nudge never re-asks. Persisted via src/data/milestonePrompts. */
  answeredMilestonePrompts: Record<string, string[]>;
```

(c) Interface action. After `openEditMilestone` (line 236), add:
```ts
  /** Retire a milestone catch-up prompt for the selected child (idempotent). */
  answerMilestonePrompt: (key: string) => void;
```

(d) Initial state. After `milestoneSheet: null,` (line 467) add:
```ts
  answeredMilestonePrompts: {},
```

(e) Hydrate. In `hydrate`, right after the prefs lines (after line 546 `if (prefs.unitSystem) ...`), add:
```ts
    // Answered milestone prompts are independent of connection state, so load
    // them once here (merges into state like the prefs above).
    set({ answeredMilestonePrompts: await loadMilestonePrompts() });
```

(f) Action. Add next to `openMilestone` (after line 1489 `closeMilestoneSheet`):
```ts
  answerMilestonePrompt: (key) => {
    const s = get();
    const childId = s.selectedChildId;
    if (!childId) return;
    const cur = s.answeredMilestonePrompts[childId] ?? [];
    if (cur.includes(key)) return; // one prompt per milestone: already answered
    const next = { ...s.answeredMilestonePrompts, [childId]: [...cur, key] };
    set({ answeredMilestonePrompts: next });
    void saveMilestonePrompts(next);
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/store/useAppStore.test.ts`
Expected: PASS (all existing 243 + the 3 new cases).

- [ ] **Step 5: Commit**

```bash
git add src/store/useAppStore.ts src/store/useAppStore.test.ts
git commit -m "feat(milestones): answeredMilestonePrompts store slice"   # remember the two trailer lines
```

---

### Task 4: Per-child fix in `MilestonesView`

**Files:**
- Modify: `src/features/milestones/MilestonesView.tsx:30`

**Interfaces:**
- Consumes: `reachedForChild` from Task 1.

This is a one-line correctness fix. It has no separate unit test (the scoping logic is covered by `reachedForChild`'s tests in Task 1); verify via typecheck and the existing suite.

- [ ] **Step 1: Apply the fix**

In `src/features/milestones/MilestonesView.tsx`, change the import (line 5) to include `reachedForChild` and drop `reachedByKey` if it is now unused:
```ts
import { MILESTONES, aroundNow, groupByCategory, reachedForChild } from '@/lib/milestones';
```

Change line 30 from:
```ts
  const reached = reachedByKey(entries);
```
to:
```ts
  // Scope to the selected child so one child's logged milestones do not count as
  // reached for another (in local mode `entries` holds every child's history).
  const reached = reachedForChild(entries, child?.id);
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0 (no "reachedByKey declared but never used", no missing symbols).

- [ ] **Step 3: Run the suite**

Run: `npm test`
Expected: PASS (unchanged count from Task 3 plus Task 1/2 additions).

- [ ] **Step 4: Commit**

```bash
git add src/features/milestones/MilestonesView.tsx
git commit -m "fix(milestones): scope reached-detection to the selected child"   # remember the two trailer lines
```

---

### Task 5: `MilestoneNudge` component + dashboard wiring

**Files:**
- Create: `src/features/milestones/MilestoneNudge.tsx`
- Modify: `src/features/dashboard/DashboardContent.tsx` (import + render at top of the returned fragment, ~line 127)

**Interfaces:**
- Consumes: `overdueUnlogged`, `reachedForChild` (Task 1); `answeredMilestonePrompts`, `answerMilestonePrompt`, `openMilestone` (Task 3 / existing store); `ageMonths(birth, now)` from `@/lib/format`.

No unit test: the vitest env is node with no RN render harness (this repo has zero component tests). Coverage of the underlying logic lives in Task 1 and Task 3. Verify by typecheck, lint, and (optional) running the app.

- [ ] **Step 1: Create the component**

Create `src/features/milestones/MilestoneNudge.tsx`:

```tsx
import { Pressable, View } from 'react-native';

import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { ageMonths } from '@/lib/format';
import { overdueUnlogged, reachedForChild } from '@/lib/milestones';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

// Stable empty ref so the raw selector never feeds a fresh array into derive
// (zustand v5: returning a new ref from a selector loops the render).
const EMPTY: string[] = [];

/**
 * Home-screen catch-up nudge. For the selected child, surfaces one milestone at
 * a time whose typical window has passed and that is not yet logged or already
 * answered. Yes routes to the normal milestone sheet; any action retires the
 * prompt for good (persisted per child). Renders nothing when there is nothing
 * to ask.
 */
export function MilestoneNudge() {
  const t = useTheme();
  // Select raw, derive in render (never return a fresh ref from a selector).
  const entries = useAppStore((s) => s.entries);
  const now = useAppStore((s) => s.now);
  const child = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId));
  const answeredMap = useAppStore((s) => s.answeredMilestonePrompts);
  const openMilestone = useAppStore((s) => s.openMilestone);
  const answerMilestonePrompt = useAppStore((s) => s.answerMilestonePrompt);

  const answered = child ? (answeredMap[child.id] ?? EMPTY) : EMPTY;
  const reached = reachedForChild(entries, child?.id);
  const months = child ? ageMonths(child.birth, now) : null;
  const overdue = overdueUnlogged(months, reached, answered);

  if (!child || overdue.length === 0) return null;

  const def = overdue[0];
  const moreCount = overdue.length - 1;
  const color = t.activity.note; // milestone accent, matches MilestoneRow

  const onYes = () => {
    answerMilestonePrompt(def.key); // retire the prompt even if the sheet is cancelled
    openMilestone(def.key); // log via the normal flow (date + optional note)
  };
  const onNotYet = () => answerMilestonePrompt(def.key);

  return (
    <View
      style={{
        backgroundColor: t.surface,
        borderWidth: 1.5,
        borderColor: hexA(color, 0.4),
        borderRadius: 18,
        paddingTop: 13,
        paddingHorizontal: 15,
        paddingBottom: 14,
        marginBottom: 8,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 26, height: 26, borderRadius: 999, backgroundColor: hexA(color, 0.18), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="milestone" color={color} size={16} />
        </View>
        <Txt weight={700} size={11.5} color={t.dim} style={{ flex: 1, textTransform: 'uppercase' }} tracking={0.6}>
          Did they already?
        </Txt>
        <Pressable
          onPress={onNotYet}
          accessibilityRole="button"
          accessibilityLabel={`Dismiss ${def.title} prompt`}
          hitSlop={8}
          style={(state) => [{ cursor: 'pointer', padding: 2 }, isHovered(state) && { opacity: 0.7 }]}
        >
          <Icon name="close" color={t.faint} size={16} />
        </Pressable>
      </View>

      <Txt weight={700} size={16} color={t.text} style={{ marginTop: 9 }}>
        {def.title}
      </Txt>
      <Txt weight={500} size={13} color={t.dim} style={{ marginTop: 2, lineHeight: 18 }}>
        {`Most babies do this around ${def.minMonths} to ${def.maxMonths} months. Has ${child.first} done this yet?`}
      </Txt>

      <View style={{ flexDirection: 'row', gap: 9, marginTop: 12 }}>
        <Pressable
          onPress={onYes}
          accessibilityRole="button"
          accessibilityLabel={`Yes, ${child.first} has reached ${def.title}`}
          style={(state) => [
            {
              flex: 1,
              backgroundColor: color,
              borderRadius: 12,
              paddingVertical: 10,
              alignItems: 'center',
              cursor: 'pointer',
            },
            isHovered(state) && { opacity: 0.9 },
          ]}
        >
          <Txt unselectable weight={700} size={14} color={t.onActivity}>
            Yes, log it
          </Txt>
        </Pressable>
        <Pressable
          onPress={onNotYet}
          accessibilityRole="button"
          accessibilityLabel={`Not yet for ${def.title}`}
          style={(state) => [
            {
              flex: 1,
              backgroundColor: 'transparent',
              borderWidth: 1.5,
              borderColor: t.line,
              borderRadius: 12,
              paddingVertical: 10,
              alignItems: 'center',
              cursor: 'pointer',
            },
            isHovered(state) && { borderColor: t.line2 },
          ]}
        >
          <Txt unselectable weight={700} size={14} color={t.dim}>
            Not yet
          </Txt>
        </Pressable>
      </View>

      {moreCount > 0 ? (
        <Txt weight={500} size={12} color={t.faint} style={{ marginTop: 9, textAlign: 'center' }}>
          {`+${moreCount} more to check`}
        </Txt>
      ) : null}
    </View>
  );
}
```

- [ ] **Step 2: Wire it into the dashboard**

In `src/features/dashboard/DashboardContent.tsx`, add the import (with the other feature imports near line 7):
```ts
import { MilestoneNudge } from '@/features/milestones/MilestoneNudge';
```

Render it as the first child of the returned fragment. Change the opening of the `return (` block (line 126-128) from:
```tsx
  return (
    <>
      {/* status strip */}
```
to:
```tsx
  return (
    <>
      <MilestoneNudge />
      {/* status strip */}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npm run lint`
Expected: no new errors in the two touched files.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS (no regressions; component has no unit test by design).

- [ ] **Step 5: Commit**

```bash
git add src/features/milestones/MilestoneNudge.tsx src/features/dashboard/DashboardContent.tsx
git commit -m "feat(milestones): home-screen catch-up nudge"   # remember the two trailer lines
```

---

## Final verification

- [ ] `npx tsc --noEmit` exits 0.
- [ ] `npm test` all green.
- [ ] `npm run lint` clean on touched files.
- [ ] Optional manual check (verify skill or Expo web): with a selected child older than a milestone's `maxMonths` and that milestone unlogged, the card appears on Home; "Not yet" and the x retire it (and it stays gone after reload); "Yes, log it" opens the milestone sheet.

## Self-review notes (plan author)

- Spec coverage: eligible-set rule -> Task 1 `overdueUnlogged`; per-child fix -> Task 1 `reachedForChild` + Task 4; persistence + one-and-done -> Task 2 + Task 3; card + actions + placement -> Task 5; retire-on-Yes -> Task 5 `onYes` (answer then open). Volume "one at a time + N more" -> Task 5. Ordering -> Task 1 sort.
- Type consistency: `overdueUnlogged(number|null, Map, readonly string[])`, `reachedForChild(Entry[], string|undefined)`, `answerMilestonePrompt(string)`, `answeredMilestonePrompts: Record<string,string[]>` are used identically across tasks.
- Deviation noted: the store action's logic is verified by the Task 3 store test rather than a separate pure helper; `MilestoneNudge` has no unit test because the repo has no RN render harness (node vitest), so its logic lives in the tested pure selectors.
