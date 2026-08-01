# Bath Vocabulary and Rhythm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename Budkin's private "small wash / big wash" vocabulary to "Quick
wash / Full bath" on screen and on the Baby Buddy wire, and replace the
count-based rhythm with a per-child, day-based one that stays correct as the
child grows.

**Architecture:** The internal `wash` union is renamed first, behind a
`normalizeWash` coercion applied at both read boundaries (AsyncStorage chunks
and the Baby Buddy note reader), so no stored value can leak the old literals
into logic. The wire tags move to a `bath:` prefix with a legacy read path, and
a standalone Node script re-tags existing server records. The rhythm becomes one
interval in days per wash type, stored per child in its own AsyncStorage module,
with due state derived from bath history on every read rather than from a
counter.

**Tech Stack:** TypeScript, React Native / Expo Router, zustand v5, AsyncStorage,
vitest, plain Node 18+ for the migration script.

**Spec:** `docs/superpowers/specs/2026-08-01-bath-vocabulary-and-rhythm-design.md`

## Global Constraints

- **No em-dashes** anywhere: prose, comments, UI copy, commit messages. Use
  commas, colons, or separate sentences.
- **zustand v5 selector rule:** never return a new reference from a
  `useAppStore` selector. No inline `.filter`/`.map`/object literals in a
  selector. Select raw fields and derive in render, or web routes blank-screen
  with "Maximum update depth exceeded".
- **Wash values on the wire are `bath:quick` / `bath:full`.** The legacy bare
  `big` tag is still READ, never written.
- **Interval range is 0 to 30 inclusive. `0` means off**, not "every zero days".
- **Test runner:** `npx vitest run <path>` for one file, `npm test` for all.
- **Typecheck:** `npx tsc --noEmit` must pass at the end of every task.
- Expo 56. Read `https://docs.expo.dev/versions/v56.0.0/` before using any Expo
  API (no task here needs one).

---

## File Structure

**Created:**
- `src/lib/wash.ts`: the `WashKind` type and `normalizeWash` coercion. In `lib`
  because `data`, `api`, `store` and `features` all import it and `lib` depends
  on none of them.
- `src/lib/wash.test.ts`
- `src/data/bathRhythm.ts`: AsyncStorage persistence for the per-child rhythm
  map. Storage only, mirroring `src/data/milestonePrompts.ts`.
- `src/data/bathRhythm.test.ts`
- `scripts/migrate-bath-tags.mjs`: one-shot server re-tagging.
- `scripts/migrate-bath-tags.test.mjs`: its pure mapping helpers.

**Modified:** `src/types/models.ts`, `src/types/timeEntry.ts`,
`src/data/entityStore.ts`, `src/data/prefs.ts`, `src/data/seed.ts`,
`src/api/client.ts`, `src/store/selectors.ts`, `src/store/useAppStore.ts`,
`src/features/log/LogSheet.tsx`, `src/features/activity/detail.ts`,
`src/features/dashboard/DashboardContent.tsx`, `src/app/settings/index.tsx`,
`vitest.config.ts`, and the existing tests that carry `wash` fixtures
(`src/api/client.test.ts`, `src/store/selectors.test.ts`,
`src/widgets/today.test.ts`).

---

### Task 1: Rename the wash union, normalize legacy values

Internal rename only. The wire and all on-screen copy stay exactly as they are,
so this task is reviewable as "no user-visible change, no server change".

**Files:**
- Create: `src/lib/wash.ts`, `src/lib/wash.test.ts`
- Modify: `src/types/models.ts:149-153`, `src/types/timeEntry.ts:69-70`,
  `src/data/entityStore.ts:139-143`, `src/api/client.ts:295-317`,
  `src/store/selectors.ts:321-328`, `src/store/useAppStore.ts:429`,
  `src/features/log/LogSheet.tsx:735-760`,
  `src/features/activity/detail.ts:111-112`,
  `src/features/dashboard/DashboardContent.tsx:137-140`, `src/data/seed.ts:47-53`
- Test: `src/lib/wash.test.ts`, `src/api/client.test.ts:258-300`,
  `src/store/selectors.test.ts:150-180`, `src/widgets/today.test.ts:249`

**Interfaces:**
- Produces: `type WashKind = 'quick' | 'full'` and
  `normalizeWash(raw: unknown): WashKind`, both from `@/lib/wash`.
  `BathEntry.wash: WashKind`, `TimeEntryState.wash?: WashKind`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/wash.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { normalizeWash } from '@/lib/wash';

describe('normalizeWash', () => {
  it('passes the current values through', () => {
    expect(normalizeWash('full')).toBe('full');
    expect(normalizeWash('quick')).toBe('quick');
  });

  it('maps the pre-2026-08 big/small values', () => {
    expect(normalizeWash('big')).toBe('full');
    expect(normalizeWash('small')).toBe('quick');
  });

  it('falls back to quick for anything unrecognised', () => {
    for (const v of [undefined, null, '', 'BIG', 'Full', 0, 1, {}, []]) {
      expect(normalizeWash(v)).toBe('quick');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/wash.test.ts`
Expected: FAIL, cannot resolve `@/lib/wash`.

- [ ] **Step 3: Create the module**

Create `src/lib/wash.ts`:

```ts
/**
 * The two kinds of bath Budkin tracks: a `full` bath in the tub, and a `quick`
 * wash of face, hands and bottom at the changing table.
 *
 * These were called `big` and `small` until 2026-08. The old values persist in
 * two places Budkin does not control: entry chunks already written to
 * AsyncStorage (`src/data/entityStore.ts`), and tags on the user's Baby Buddy
 * server. Both read boundaries must therefore run stored values through
 * `normalizeWash`.
 *
 * That is not cosmetic. `washDueState` compares against `'quick'`, so a device
 * full of `'small'` entries would report every bath as a full bath and a full
 * bath would never come due. The failure is silent: the feature just stops.
 */
export type WashKind = 'quick' | 'full';

/**
 * Coerce any persisted or server-supplied value to a `WashKind`. `full` and the
 * legacy `big` mean full; everything else means quick, preserving the historical
 * rule where anything not explicitly big read as small.
 */
export function normalizeWash(raw: unknown): WashKind {
  return raw === 'full' || raw === 'big' ? 'full' : 'quick';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/wash.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Widen the types**

`src/types/models.ts`, replacing lines 145-153. The existing doc comment names
the old vocabulary, so it changes with the type:

```ts
/**
 * A bath (Baby Buddy has no bath resource, so it rides on `/api/notes/` behind
 * a `bath` tag). Point event, no duration. `wash` distinguishes the frequent
 * quick wash from the periodic full bath.
 */
export interface BathEntry extends EntryBase {
  type: 'bath';
  time: number;
  wash: WashKind;
}
```

Add to the imports at the top of `src/types/models.ts`:

```ts
import type { WashKind } from '@/lib/wash';
```

`src/types/timeEntry.ts:69-70`:

```ts
  /** bath (point): which wash was given */
  wash?: WashKind;
```

with `import type { WashKind } from '@/lib/wash';` added to its imports.

`src/store/useAppStore.ts:429`:

```ts
  setWash: (wash: WashKind) => void;
```

with `WashKind` added to the `@/lib/wash` import.

- [ ] **Step 6: Normalize at the local read boundary**

`src/data/entityStore.ts`, replacing `parseEntryArray` at lines 139-143:

```ts
/**
 * Parses a persisted entry-array value; anything but an array counts as corrupt.
 *
 * Bath entries are additionally run through `normalizeWash`. Chunks written
 * before the 2026-08 rename hold `wash: 'small' | 'big'` verbatim, and this is
 * the single funnel every stored entry passes through, so normalising here is
 * what stops the old literals reaching the rhythm comparison in `washDueState`.
 */
function parseEntryArray(raw: string | null): Entry[] {
  const parsed = parseOr<Entry[]>(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((e) =>
    e?.type === 'bath' ? { ...e, wash: normalizeWash((e as { wash?: unknown }).wash) } : e,
  );
}
```

Add `import { normalizeWash } from '@/lib/wash';` to its imports.

- [ ] **Step 7: Keep the wire byte-identical while the internals move**

`src/api/client.ts`. The wire rename is Task 2, so here the new internal literals
are mapped back to the old tag names on write and mapped forward on read.

Replace the body of `bathToNoteBody` (lines 295-303):

```ts
export function bathToNoteBody(entry: BathEntry, childServerId: number): Record<string, unknown> {
  const userTags = entry.tags.filter((t) => !BATH_STRUCTURAL_TAGS.includes(t) && !isStructuralMilestoneTag(t));
  // Task 2 replaces this mapping with the `bath:` prefixed tags. Until then the
  // wire stays byte-identical so this task changes nothing a server can see.
  const wireWash = entry.wash === 'full' ? 'big' : 'small';
  return {
    child: childServerId,
    time: toISO(entry.time),
    note: `Bath, ${wireWash} wash`,
    tags: ['bath', wireWash, ...userTags],
  };
}
```

And in `noteToBathEntry` (line 314):

```ts
    wash: tags.includes('big') ? 'full' : 'quick',
```

- [ ] **Step 8: Update the remaining consumers to the new literals**

Copy stays old in all four; only the compared values change.

`src/store/selectors.ts:327`:

```ts
  return recent.length === n && recent.every((b) => b.wash === 'quick') ? 'full' : 'quick';
```

and its signature on line 321:

```ts
export function nextWashKind(entries: Entry[], smallWashesPerBig: number = SMALL_WASHES_PER_BIG_DEFAULT): WashKind {
```

with `import type { WashKind } from '@/lib/wash';` added.

`src/features/activity/detail.ts:112`:

```ts
      return e.wash === 'full' ? 'Big wash' : 'Small wash';
```

`src/features/dashboard/DashboardContent.tsx:140`:

```ts
  const washHint = washedToday ? 'Washed today' : washKind === 'full' ? 'Big wash due today' : 'Small wash due';
```

`src/features/log/LogSheet.tsx:739-753`, three lines inside the existing block:

```tsx
              {(['quick', 'full'] as const).map((w) => {
                const selected = (te.wash ?? 'quick') === w;
```

```tsx
                      {w === 'quick' ? 'Small wash' : 'Big wash'}
```

`src/data/seed.ts:50-53`:

```ts
      { id: 'e8', childId: c1, type: 'bath', time: now - 4 * DAY, wash: 'full', tags: [] },
      { id: 'e9', childId: c1, type: 'bath', time: now - 3 * DAY, wash: 'quick', tags: [] },
      { id: 'e10', childId: c1, type: 'bath', time: now - 2 * DAY, wash: 'quick', tags: [] },
      { id: 'e11', childId: c1, type: 'bath', time: now - 1 * DAY, wash: 'quick', tags: [] },
```

- [ ] **Step 9: Prove the local read boundary normalizes**

This is the most important test in the whole plan: it is what stops a device
full of `'small'` entries silently killing the rhythm.

Add to `src/data/entityStore.test.ts`, inside `describe('entityStore persistence')`.
That file already mocks AsyncStorage through a `vi.hoisted` `mem.store` map, so
a legacy chunk is written by seeding that map directly rather than through
`saveEntries` (which would only ever write current-shape values):

```ts
  it('normalizes pre-2026-08 wash values when loading entry chunks', async () => {
    // A chunk exactly as a build before the rename would have left it.
    mem.store.set(
      'budkin.entries.v2.2026-03',
      JSON.stringify([
        { id: 'b1', childId: 'c1', type: 'bath', time: new Date(2026, 2, 4).getTime(), wash: 'small', tags: [] },
        { id: 'b2', childId: 'c1', type: 'bath', time: new Date(2026, 2, 5).getTime(), wash: 'big', tags: [] },
      ]),
    );
    const loaded = await loadEntities();
    const washes = loaded!.entries
      .filter((e): e is Extract<Entry, { type: 'bath' }> => e.type === 'bath')
      .sort((a, b) => a.time - b.time)
      .map((e) => e.wash);
    expect(washes).toEqual(['quick', 'full']);
  });
```

Run: `npx vitest run src/data/entityStore.test.ts`
Expected: FAIL before Step 6's change is in place (received `['small', 'big']`),
PASS after. If it passes without Step 6, the normalizer is not on the load path
and Step 6 was applied to the wrong function.

- [ ] **Step 10: Update existing test fixtures**

In `src/store/selectors.test.ts`, the `describe('nextWashKind')` block at line
150: change the helper signature and both literals.

```ts
  const bath = (time: number, wash: 'quick' | 'full'): Entry => ({
    id: `b-${time}`,
    childId: 'c1',
    type: 'bath',
    time,
    wash,
    tags: [],
  });

  /** `n` consecutive quick washes, oldest first, ending one minute ago. */
  const quicks = (n: number): Entry[] => Array.from({ length: n }, (_, i) => bath(NOW - (n - i) * M, 'quick'));
```

Rename every `smalls(` call in that block to `quicks(`, and every expected
`'small'` to `'quick'` and `'big'` to `'full'`.

In `src/widgets/today.test.ts:249`, change `wash: 'small'` to `wash: 'quick'`.

In `src/api/client.test.ts`, lines 258-300: change the two `BathEntry` fixtures
to `wash: 'quick'` and `wash: 'full'`, and the two read expectations from
`'big'`/`'small'` to `'full'`/`'quick'`. Leave every `note:` and `tags:` string
untouched, since this task does not change the wire.

- [ ] **Step 11: Run the full suite and the typechecker**

Run: `npm test && npx tsc --noEmit`
Expected: all tests PASS, no type errors. The typecheck is the real gate here:
it is what proves no `'small'` or `'big'` literal survives in a `wash` position.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "refactor(bath): rename the wash union to quick/full, normalize legacy values"
```

---

### Task 2: Move the structural tags to the `bath:` prefix

**Files:**
- Modify: `src/api/client.ts:179-194`, `src/api/client.ts:295-317`
- Test: `src/api/client.test.ts:258-305`

**Interfaces:**
- Consumes: `WashKind` from Task 1.
- Produces: notes written with tags `['bath', 'bath:quick' | 'bath:full', ...]`
  and body `'Quick wash'` / `'Full bath'`.

- [ ] **Step 1: Write the failing tests**

Replace the bath serialization tests in `src/api/client.test.ts` (lines 258-305)
with:

```ts
  it('encodes a quick wash as a tagged note the tags own as the source of truth', () => {
    const entry: BathEntry = { id: 'e1', childId: 'c1', type: 'bath', time: TIME, wash: 'quick', tags: [] };
    expect(bathToNoteBody(entry, 3)).toEqual({
      child: 3,
      time: toISO(TIME),
      note: 'Quick wash',
      tags: ['bath', 'bath:quick'],
    });
  });

  it('encodes a full bath and keeps user tags after the structural ones', () => {
    const entry: BathEntry = { id: 'e2', childId: 'c1', type: 'bath', time: TIME, wash: 'full', tags: ['Fussy'] };
    expect(bathToNoteBody(entry, 3)).toEqual({
      child: 3,
      time: toISO(TIME),
      note: 'Full bath',
      tags: ['bath', 'bath:full', 'Fussy'],
    });
  });

  it('never writes the legacy bare tags back, even when the entry carried them', () => {
    const entry: BathEntry = { id: 'e3', childId: 'c1', type: 'bath', time: TIME, wash: 'full', tags: ['big', 'small', 'Fussy'] };
    expect(bathToNoteBody(entry, 3).tags).toEqual(['bath', 'bath:full', 'Fussy']);
  });

  it('reads a note back into a bath entry, deriving wash from the tags', () => {
    const note = { id: 42, child: 'c1', time: '2026-03-04T18:30:00Z', note: 'Full bath', tags: ['bath', 'bath:full', 'Fussy'] };
    expect(noteToBathEntry(note, 'c1')).toEqual({
      id: 'bath-42',
      serverId: 42,
      childId: 'c1',
      type: 'bath',
      time: fromISO('2026-03-04T18:30:00Z'),
      wash: 'full',
      tags: ['Fussy'],
    });
  });

  it('reads a pre-migration note through the legacy bare big tag', () => {
    const note = { id: 43, child: 'c1', time: '2026-03-04T18:30:00Z', note: 'Bath, big wash', tags: ['bath', 'big'] };
    expect(noteToBathEntry(note, 'c1').wash).toBe('full');
  });

  it('treats a note with neither full marker as a quick wash', () => {
    const note = { id: 7, child: 'c1', time: '2026-03-04T18:30:00Z', note: 'Bath, small wash', tags: ['bath', 'small'] };
    expect(noteToBathEntry(note, 'c1').wash).toBe('quick');
  });

  it('strips both tag vocabularies from the entry tags', () => {
    const note = { id: 8, child: 'c1', time: '2026-03-04T18:30:00Z', note: 'x', tags: ['bath', 'big', 'bath:full', 'Fussy'] };
    expect(noteToBathEntry(note, 'c1').tags).toEqual(['Fussy']);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/api/client.test.ts`
Expected: FAIL, received `tags: ['bath', 'big']` and `note: 'Bath, big wash'`.

- [ ] **Step 3: Implement**

`src/api/client.ts`, replacing lines 179-194:

```ts
// --- bath <-> Baby Buddy Note (tagged-note) serialization ---
// Baby Buddy has no bath resource, so a bath is a Note tagged `bath` plus the
// wash size. The tags are the source of truth on read; the body is human copy
// only, so other Baby Buddy clients see a meaningful entry. User tags are kept
// distinct from these structural tags so they survive a round-trip untouched.
//
// The size tag was a bare `small`/`big` until 2026-08 and is now `bath:quick`/
// `bath:full`, matching the `intake:` and `mk:` prefix convention. The bare
// words are still READ (a note the migration script has not reached, or one an
// older Budkin wrote, must not come back as the wrong wash) and never written.
// They stay in the structural list so they remain stripped from user tags and
// hidden from the picker: freeing two ordinary English words would let a user
// tag literally named `big` read back as a full bath.
const BATH_STRUCTURAL_TAGS = ['bath', 'bath:quick', 'bath:full', 'small', 'big'];

/**
 * Tags the tag picker must never surface or let the user create: the bath
 * structural tags plus the breastfeeding "both" side markers (`left`/`right`)
 * that `save()` folds into an entry's tags. They must still round-trip untouched
 * on entries that legitimately carry them, so this set only gates the UI
 * (display + creation), not serialization.
 */
export const HIDDEN_TAGS = new Set<string>([...BATH_STRUCTURAL_TAGS, 'left', 'right']);
```

Replace `bathToNoteBody` (lines 295-303):

```ts
export function bathToNoteBody(entry: BathEntry, childServerId: number): Record<string, unknown> {
  const userTags = entry.tags.filter((t) => !BATH_STRUCTURAL_TAGS.includes(t) && !isStructuralMilestoneTag(t));
  const full = entry.wash === 'full';
  return {
    child: childServerId,
    time: toISO(entry.time),
    // Self-contained, so it reads as a real entry in Baby Buddy's own note list.
    note: full ? 'Full bath' : 'Quick wash',
    tags: ['bath', full ? 'bath:full' : 'bath:quick', ...userTags],
  };
}
```

And in `noteToBathEntry`, line 314:

```ts
    // `bath:full` is current, a bare `big` is pre-2026-08. Reading both means a
    // note the migration has not reached still yields the right wash, and it
    // self-heals: the next edit rewrites the note with the current tags.
    wash: tags.includes('bath:full') || tags.includes('big') ? 'full' : 'quick',
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/api/client.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(bath): move the wash tags to bath:quick / bath:full on the wire"
```

---

### Task 3: On-screen copy

**Files:**
- Modify: `src/features/log/LogSheet.tsx:735-760`,
  `src/features/activity/detail.ts:111-112`,
  `src/features/dashboard/DashboardContent.tsx:140`
- Test: none. This is copy with no branching logic; the rendering is already
  covered and there is no snapshot suite to update.

**Interfaces:**
- Consumes: `WashKind` from Task 1.

- [ ] **Step 1: Log sheet**

`src/features/log/LogSheet.tsx`, the block at lines 734-760. Two lines change:

```tsx
        {/* bath fields, quick wash vs full bath */}
        {type === 'bath' && (
          <>
            <FieldLabel hint="follows your rhythm">Bath type</FieldLabel>
```

and the option label at line 753:

```tsx
                      {w === 'quick' ? 'Quick wash' : 'Full bath'}
```

- [ ] **Step 2: History detail**

`src/features/activity/detail.ts:112`:

```ts
      return e.wash === 'full' ? 'Full bath' : 'Quick wash';
```

- [ ] **Step 3: Home tile**

`src/features/dashboard/DashboardContent.tsx:140`:

```ts
  const washHint = washedToday ? 'Washed today' : washKind === 'full' ? 'Full bath due today' : 'Quick wash due';
```

- [ ] **Step 4: Verify**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, no type errors.

Then grep for stragglers:

Run: `grep -rn "Small wash\|Big wash\|small wash\|big wash" src/`
Expected: only `src/app/settings/index.tsx` (rewritten in Task 8) and comments
that describe the legacy wire vocabulary on purpose.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(bath): rename the on-screen wash vocabulary to quick wash / full bath"
```

---

### Task 4: Per-child rhythm storage

**Files:**
- Create: `src/data/bathRhythm.ts`, `src/data/bathRhythm.test.ts`
- Modify: `src/types/models.ts`

**Interfaces:**
- Produces: `interface BathRhythm { fullEveryDays: number; quickEveryDays: number }`
  from `@/types/models`; `loadBathRhythms(): Promise<Record<string, BathRhythm>>`
  and `saveBathRhythms(map: Record<string, BathRhythm>): Promise<void>` from
  `@/data/bathRhythm`.

- [ ] **Step 1: Write the failing test**

Create `src/data/bathRhythm.test.ts`. The AsyncStorage mock is copied verbatim
from `src/data/prefs.test.ts:5-17`; note it exposes no `clear()`, so state is
reset by emptying the backing map.

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadBathRhythms, saveBathRhythms } from '@/data/bathRhythm';

// In-memory stand-in for the native AsyncStorage module.
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

const KEY = 'budkin.bathRhythm.v1';

beforeEach(() => {
  mem.store.clear();
});

describe('bathRhythm storage', () => {
  it('returns an empty map when nothing is stored', async () => {
    expect(await loadBathRhythms()).toEqual({});
  });

  it('round-trips a per-child map', async () => {
    const map = { c1: { fullEveryDays: 3, quickEveryDays: 1 }, c2: { fullEveryDays: 1, quickEveryDays: 0 } };
    await saveBathRhythms(map);
    expect(await loadBathRhythms()).toEqual(map);
  });

  it('treats unparseable storage as empty rather than throwing', async () => {
    mem.store.set(KEY, '{not json');
    expect(await loadBathRhythms()).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/bathRhythm.test.ts`
Expected: FAIL, cannot resolve `@/data/bathRhythm`.

- [ ] **Step 3: Add the type**

In `src/types/models.ts`, next to the other small domain types:

```ts
/**
 * One child's bath rhythm: how often each kind of wash is due, in whole days.
 * `0` means that kind is off and never comes due, which is how the rhythm
 * survives the child growing up (a newborn has no full baths at all, a school-age
 * child has no scheduled quick washes).
 *
 * Per child rather than global because a 4-month-old and a 3-year-old sit at
 * opposite ends of that progression. Persisted by `src/data/bathRhythm.ts`.
 */
export interface BathRhythm {
  fullEveryDays: number;
  quickEveryDays: number;
}
```

- [ ] **Step 4: Create the storage module**

Create `src/data/bathRhythm.ts`:

```ts
/**
 * Persisted on-device bath rhythm, per child. Backed by AsyncStorage, mirroring
 * src/data/milestonePrompts.ts and src/data/prefs.ts.
 *
 * Deliberately NOT part of `Prefs`: every pref in src/data/prefs.ts is global,
 * and this one is per child, so it gets its own key rather than making that file
 * carry an exception. Shape: { [childId]: BathRhythm }.
 *
 * Keying by child id is only safe because child ids stopped mutating on push.
 * Under the older model this map would have been orphaned the first time a child
 * synced to the server.
 *
 * Local only. Baby Buddy has no notion of wash cadence, so nothing here is ever
 * sent to a server.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { BathRhythm } from '@/types/models';

const KEY = 'budkin.bathRhythm.v1';

export async function loadBathRhythms(): Promise<Record<string, BathRhythm>> {
  try {
    const s = await AsyncStorage.getItem(KEY);
    if (!s) return {};
    const parsed = JSON.parse(s) as Record<string, BathRhythm>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    console.warn('[bathRhythm] loadBathRhythms failed:', e);
    return {};
  }
}

export async function saveBathRhythms(map: Record<string, BathRhythm>): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(map));
  } catch (e) {
    console.warn('[bathRhythm] saveBathRhythms failed:', e);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/data/bathRhythm.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(bath): persist a per-child bath rhythm"
```

---

### Task 5: The day-based due model

The heart of the change. `nextWashKind`, `clampSmallWashesPerBig` and the three
`SMALL_WASHES_PER_BIG_*` constants are deleted and replaced.

**Files:**
- Modify: `src/store/selectors.ts:280-328`
- Test: `src/store/selectors.test.ts:150-180` (replace the `nextWashKind` block)

**Interfaces:**
- Consumes: `BathRhythm` from `@/types/models`, `WashKind` from `@/lib/wash`,
  `startOfDay` from `@/store/selectors`.
- Produces, all from `@/store/selectors`:
  - `BATH_RHYTHM_DEFAULT: BathRhythm`
  - `BATH_INTERVAL_MIN = 0`, `BATH_INTERVAL_MAX = 30`
  - `clampBathInterval(n: number, fallback: number): number`
  - `clampBathRhythm(r: Partial<BathRhythm> | undefined, fallback: BathRhythm): BathRhythm`
  - `legacyBathRhythm(smallWashesPerBig: number | undefined): BathRhythm`
  - `rhythmForChild(map: Record<string, BathRhythm>, childId: string | null, fallback: BathRhythm): BathRhythm`
  - `interface WashUpcoming { kind: WashKind; inDays: number }`
  - `interface WashDue { full: boolean; quick: boolean; nextKind: WashKind; upcoming: WashUpcoming | null }`
  - `washDueState(entries: Entry[], rhythm: BathRhythm, now: number): WashDue`

- [ ] **Step 1: Write the failing tests**

Replace the whole `describe('nextWashKind')` block in
`src/store/selectors.test.ts` with:

```ts
describe('washDueState', () => {
  const DAY = 86400000;
  // Midday, so adding whole days never lands on a DST boundary edge.
  const NOON = new Date(2026, 5, 15, 12, 0, 0).getTime();

  const bath = (daysAgo: number, wash: 'quick' | 'full'): Entry => ({
    id: `b-${daysAgo}-${wash}`,
    childId: 'c1',
    type: 'bath',
    time: NOON - daysAgo * DAY,
    wash,
    tags: [],
  });

  const R = (fullEveryDays: number, quickEveryDays: number) => ({ fullEveryDays, quickEveryDays });

  it('reads both kinds as due with no bath history at all', () => {
    const s = washDueState([], R(3, 1), NOON);
    expect(s.full).toBe(true);
    expect(s.quick).toBe(true);
    expect(s.nextKind).toBe('full');
  });

  it('is not due on the day of the bath', () => {
    const s = washDueState([bath(0, 'full')], R(3, 1), NOON);
    expect(s.full).toBe(false);
    expect(s.quick).toBe(false);
  });

  it('brings a quick wash due the next day', () => {
    const s = washDueState([bath(1, 'full')], R(3, 1), NOON);
    expect(s.quick).toBe(true);
    expect(s.full).toBe(false);
    expect(s.nextKind).toBe('quick');
  });

  it('brings a full bath due exactly on its interval', () => {
    expect(washDueState([bath(2, 'full')], R(3, 1), NOON).full).toBe(false);
    expect(washDueState([bath(3, 'full')], R(3, 1), NOON).full).toBe(true);
    expect(washDueState([bath(9, 'full')], R(3, 1), NOON).full).toBe(true);
  });

  it('prefers the full bath when both are due', () => {
    expect(washDueState([bath(5, 'full')], R(3, 1), NOON).nextKind).toBe('full');
  });

  // The asymmetry that makes the model survive the child growing up.
  it('lets any bath satisfy the quick-wash clock', () => {
    const s = washDueState([bath(4, 'full'), bath(0, 'quick')], R(3, 1), NOON);
    expect(s.quick).toBe(false);
    expect(s.full).toBe(true);
  });

  it('does not let a quick wash satisfy the full-bath clock', () => {
    const entries = [bath(3, 'full'), bath(2, 'quick'), bath(1, 'quick'), bath(0, 'quick')];
    expect(washDueState(entries, R(3, 1), NOON).full).toBe(true);
  });

  it('never surfaces a quick wash of its own once full baths are daily', () => {
    const s = washDueState([bath(1, 'full')], R(1, 1), NOON);
    expect(s.full).toBe(true);
    expect(s.nextKind).toBe('full');
  });

  it('treats 0 as off, per axis, independently', () => {
    expect(washDueState([bath(9, 'quick')], R(0, 1), NOON).full).toBe(false);
    expect(washDueState([bath(9, 'quick')], R(3, 0), NOON).quick).toBe(false);
    const off = washDueState([], R(0, 0), NOON);
    expect(off.full).toBe(false);
    expect(off.quick).toBe(false);
    expect(off.upcoming).toBeNull();
  });

  it('reports the sooner upcoming wash when nothing is due', () => {
    expect(washDueState([bath(1, 'full')], R(4, 3), NOON).upcoming).toEqual({ kind: 'quick', inDays: 2 });
    expect(washDueState([bath(1, 'full')], R(3, 5), NOON).upcoming).toEqual({ kind: 'full', inDays: 2 });
  });

  it('reports no upcoming wash while one is already due', () => {
    expect(washDueState([bath(5, 'quick')], R(3, 1), NOON).upcoming).toBeNull();
  });

  it('skips an axis that is off when choosing the upcoming wash', () => {
    expect(washDueState([bath(1, 'full')], R(4, 0), NOON).upcoming).toEqual({ kind: 'full', inDays: 3 });
  });

  it('counts calendar days, not 24-hour periods', () => {
    // Bathed at 19:00 yesterday, asked at 08:00 today: one calendar day, so a
    // daily quick wash is due even though only 13 hours have passed.
    const evening = new Date(2026, 5, 14, 19, 0, 0).getTime();
    const morning = new Date(2026, 5, 15, 8, 0, 0).getTime();
    const entry: Entry = { id: 'b', childId: 'c1', type: 'bath', time: evening, wash: 'full', tags: [] };
    expect(washDueState([entry], R(3, 1), morning).quick).toBe(true);
  });

  it('scopes nothing itself: a sibling filter is the caller job', () => {
    // Documents the contract rather than the code: entries must already be
    // scoped with entriesForChild, exactly like the other status helpers.
    const mine = washDueState([bath(0, 'full')], R(3, 1), NOON);
    expect(mine.full).toBe(false);
  });
});

describe('bath rhythm values', () => {
  it('clamps an interval into 0..30 and rounds', () => {
    expect(clampBathInterval(-4, 3)).toBe(0);
    expect(clampBathInterval(0, 3)).toBe(0);
    expect(clampBathInterval(2.4, 3)).toBe(2);
    expect(clampBathInterval(500, 3)).toBe(30);
  });

  it('falls back rather than inventing a value for a non-number', () => {
    expect(clampBathInterval(NaN, 3)).toBe(3);
    expect(clampBathInterval(Infinity, 3)).toBe(3);
  });

  it('translates the legacy count rhythm to days, plus one', () => {
    expect(legacyBathRhythm(3)).toEqual({ fullEveryDays: 4, quickEveryDays: 1 });
    expect(legacyBathRhythm(1)).toEqual({ fullEveryDays: 2, quickEveryDays: 1 });
  });

  it('uses the built-in default when no legacy value was ever stored', () => {
    expect(legacyBathRhythm(undefined)).toEqual(BATH_RHYTHM_DEFAULT);
    expect(BATH_RHYTHM_DEFAULT).toEqual({ fullEveryDays: 3, quickEveryDays: 1 });
  });

  it('prefers a stored per-child rhythm over the fallback', () => {
    const map = { c1: { fullEveryDays: 1, quickEveryDays: 0 } };
    expect(rhythmForChild(map, 'c1', BATH_RHYTHM_DEFAULT)).toEqual({ fullEveryDays: 1, quickEveryDays: 0 });
    expect(rhythmForChild(map, 'c2', BATH_RHYTHM_DEFAULT)).toEqual(BATH_RHYTHM_DEFAULT);
    expect(rhythmForChild(map, null, BATH_RHYTHM_DEFAULT)).toEqual(BATH_RHYTHM_DEFAULT);
  });

  it('clamps a stored rhythm on the way out, so a bad write cannot poison it', () => {
    const map = { c1: { fullEveryDays: 999, quickEveryDays: -2 } } as Record<string, BathRhythm>;
    expect(rhythmForChild(map, 'c1', BATH_RHYTHM_DEFAULT)).toEqual({ fullEveryDays: 30, quickEveryDays: 0 });
  });
});
```

Update the import at the top of `src/store/selectors.test.ts`: remove
`nextWashKind`, `clampSmallWashesPerBig` and `SMALL_WASHES_PER_BIG_DEFAULT`; add
`washDueState`, `clampBathInterval`, `legacyBathRhythm`, `rhythmForChild` and
`BATH_RHYTHM_DEFAULT`. Add `import type { BathRhythm } from '@/types/models';`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/store/selectors.test.ts`
Expected: FAIL, `washDueState` is not exported.

- [ ] **Step 3: Implement**

In `src/store/selectors.ts`, delete lines 280-328 entirely (the
`SMALL_WASHES_PER_BIG_*` constants, `clampSmallWashesPerBig` and
`nextWashKind`) and put this in their place. `startOfDay` stays where it is at
line 480: it is a function declaration, so it hoists and needs no reordering.
`src/store/selectors.ts` has no existing `DAY` constant, so the one below is
free to add.

```ts
const DAY = 24 * 60 * M;

/**
 * The built-in rhythm for a child with nothing configured: a full bath every 3
 * days, a quick wash daily. Three matches the mainstream 2-to-3-full-baths-a-week
 * guidance for an infant.
 */
export const BATH_RHYTHM_DEFAULT: BathRhythm = { fullEveryDays: 3, quickEveryDays: 1 };

/**
 * 0 to 30 days. 0 is not a degenerate value here, it is the OFF switch: that
 * kind of wash never comes due. This reverses the old count-model rule, which
 * banned 0 because an empty lookback window made `every()` vacuously true and
 * latched "big wash due" forever. That hazard is gone with the counting. Do not
 * restore a minimum of 1 on the strength of the old comment.
 *
 * 30 is a soft cap: far past any rhythm a person keeps, but low enough that a
 * typo like 500 is caught rather than quietly meaning "never".
 */
export const BATH_INTERVAL_MIN = 0;
export const BATH_INTERVAL_MAX = 30;

/**
 * Coerce one interval into range. A non-finite value returns `fallback` rather
 * than 0, because silently switching a reminder off is worse than keeping the
 * previous cadence.
 */
export function clampBathInterval(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(BATH_INTERVAL_MAX, Math.max(BATH_INTERVAL_MIN, Math.round(n)));
}

/** Coerce a whole rhythm, filling each missing axis from `fallback`. */
export function clampBathRhythm(r: Partial<BathRhythm> | undefined, fallback: BathRhythm): BathRhythm {
  return {
    fullEveryDays: clampBathInterval(r?.fullEveryDays ?? fallback.fullEveryDays, fallback.fullEveryDays),
    quickEveryDays: clampBathInterval(r?.quickEveryDays ?? fallback.quickEveryDays, fallback.quickEveryDays),
  };
}

/**
 * The rhythm implied by the pre-2026-08 global pref, used as the fallback for a
 * child with nothing stored. `smallWashesPerBig: 3` meant a full bath on the 4th
 * bath of the cycle, which on daily bathing is every 4 days, so the translation
 * is `+ 1`. That preserves the cadence an existing user already feels; a fresh
 * install with no legacy value gets `BATH_RHYTHM_DEFAULT` instead.
 *
 * Stateless on purpose. Deriving the fallback on read rather than running a
 * seeding pass at hydration means no write, no ordering dependency between prefs
 * and children loading, and it stays idempotent.
 */
export function legacyBathRhythm(smallWashesPerBig: number | undefined): BathRhythm {
  if (smallWashesPerBig == null || !Number.isFinite(smallWashesPerBig)) return BATH_RHYTHM_DEFAULT;
  return {
    fullEveryDays: clampBathInterval(Math.round(smallWashesPerBig) + 1, BATH_RHYTHM_DEFAULT.fullEveryDays),
    quickEveryDays: 1,
  };
}

/** One child's rhythm: their stored entry if they have one, else `fallback`. */
export function rhythmForChild(
  map: Record<string, BathRhythm>,
  childId: string | null,
  fallback: BathRhythm,
): BathRhythm {
  const stored = childId ? map[childId] : undefined;
  return stored ? clampBathRhythm(stored, fallback) : fallback;
}

/** The next wash to come due, once neither is due yet. */
export interface WashUpcoming {
  kind: WashKind;
  inDays: number;
}

export interface WashDue {
  /** a full bath is due today or overdue */
  full: boolean;
  /** a quick wash is due today or overdue */
  quick: boolean;
  /** what to pre-select in the log sheet; `full` wins when both are due */
  nextKind: WashKind;
  /** the sooner upcoming wash, or null while one is already due or both are off */
  upcoming: WashUpcoming | null;
}

/**
 * What each kind of wash owes today, from the child's rhythm and their bath
 * history.
 *
 * The load-bearing asymmetry: ANY bath resets the quick-wash clock, but only a
 * FULL bath resets the full-bath clock. A full bath is a quick wash and more, so
 * it satisfies the lesser obligation. That is what lets the same two numbers
 * describe a newborn (full off, quick 1) and a toddler (full 1, quick 1): once
 * full baths are daily, every bath resets the quick clock, so the quick wash
 * stops surfacing on its own without anyone disabling it.
 *
 * Distance is measured in local CALENDAR days, not 24-hour blocks, because the
 * schedule is a bedtime routine: a Monday evening bath reads as two days by
 * Wednesday morning. `Math.round` over the `startOfDay` difference absorbs the
 * 23 and 25-hour days at a DST boundary.
 *
 * Derived from history on every call, never from a stored counter, so editing an
 * interval re-reads the existing baths immediately. Never bathed means due.
 *
 * Pure and `now`-parametrised: scope the entries to the child first
 * (`entriesForChild`), exactly like the other status helpers.
 */
export function washDueState(entries: Entry[], rhythm: BathRhythm, now: number): WashDue {
  const baths = entries
    .filter((e): e is Extract<Entry, { type: 'bath' }> => e.type === 'bath')
    .sort((a, b) => b.time - a.time);
  const today = startOfDay(now);
  const daysSince = (e: { time: number } | undefined): number | null =>
    e ? Math.round((today - startOfDay(e.time)) / DAY) : null;

  const fullEvery = clampBathInterval(rhythm.fullEveryDays, BATH_RHYTHM_DEFAULT.fullEveryDays);
  const quickEvery = clampBathInterval(rhythm.quickEveryDays, BATH_RHYTHM_DEFAULT.quickEveryDays);

  const sinceFull = daysSince(baths.find((b) => b.wash === 'full'));
  const sinceAny = daysSince(baths[0]);

  const full = fullEvery > 0 && (sinceFull === null || sinceFull >= fullEvery);
  const quick = quickEvery > 0 && (sinceAny === null || sinceAny >= quickEvery);

  let upcoming: WashUpcoming | null = null;
  if (!full && !quick) {
    const untilFull = fullEvery > 0 && sinceFull !== null ? fullEvery - sinceFull : null;
    const untilQuick = quickEvery > 0 && sinceAny !== null ? quickEvery - sinceAny : null;
    // Ties go to the full bath: it is the more significant of the two.
    if (untilFull !== null && (untilQuick === null || untilFull <= untilQuick)) {
      upcoming = { kind: 'full', inDays: untilFull };
    } else if (untilQuick !== null) {
      upcoming = { kind: 'quick', inDays: untilQuick };
    }
  }

  return { full, quick, nextKind: full ? 'full' : 'quick', upcoming };
}
```

Add to the imports at the top of `src/store/selectors.ts`:

```ts
import type { WashKind } from '@/lib/wash';
```

and add `BathRhythm` to the existing `@/types/models` type import.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/store/selectors.test.ts`
Expected: PASS. `npx tsc --noEmit` still FAILS at this point, because
`useAppStore.ts`, `DashboardContent.tsx` and `settings/index.tsx` still import
the deleted `nextWashKind` and `clampSmallWashesPerBig`. Tasks 6, 7 and 8 fix
those three in turn. Do not paper over it here.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(bath): derive wash due state from day intervals instead of a bath count"
```

---

### Task 6: Store wiring and the prefs retirement

Restores the typecheck for everything except the two view files.

**Files:**
- Modify: `src/data/prefs.ts:56-62`, `src/store/useAppStore.ts` (state at 168-176,
  defaults at 1226, setter at 1334-1340, hydration at 1424-1430, pre-selection at
  2730-2740), `src/data/seed.ts:45-53`
- Test: `src/store/useAppStore.test.ts`

**Interfaces:**
- Consumes: `loadBathRhythms`/`saveBathRhythms` (Task 4), `legacyBathRhythm`,
  `rhythmForChild`, `clampBathRhythm`, `washDueState` (Task 5).
- Produces, on the store: `bathRhythms: Record<string, BathRhythm>`,
  `legacyRhythm: BathRhythm`, and
  `setBathRhythm(childId: string, patch: Partial<BathRhythm>): void`.

- [ ] **Step 1: Retire the pref**

`src/data/prefs.ts`. Delete the `smallWashesPerBig` field from the `Prefs`
interface (lines 57-62) and add, directly below the interface:

```ts
/**
 * Fields Budkin no longer writes, kept readable so a stored value can be
 * migrated forward. Not part of `Prefs`, so nothing can accidentally save one.
 */
export interface LegacyPrefs {
  /**
   * Pre-2026-08 bath rhythm: SMALL washes between two big ones. Superseded by
   * the per-child day intervals in src/data/bathRhythm.ts, and read only to
   * derive the fallback for a child with nothing stored (`legacyBathRhythm`).
   */
  smallWashesPerBig?: number;
}
```

Change the `loadPrefs` return type:

```ts
export async function loadPrefs(): Promise<Partial<Prefs> & LegacyPrefs> {
```

and its internal cast to match:

```ts
    return JSON.parse(s) as Partial<Prefs> & LegacyPrefs;
```

- [ ] **Step 2: Write the failing test**

Add to `src/store/useAppStore.test.ts`, matching however that file already
constructs and resets the store:

```ts
  it('seeds a child rhythm from the legacy pref, plus one day', async () => {
    await AsyncStorage.setItem('budkin.prefs.v1', JSON.stringify({ smallWashesPerBig: 5 }));
    await useAppStore.getState().hydrate();
    expect(useAppStore.getState().legacyRhythm).toEqual({ fullEveryDays: 6, quickEveryDays: 1 });
    expect(useAppStore.getState().bathRhythms).toEqual({});
  });

  it('falls back to the built-in default with no legacy pref stored', async () => {
    await useAppStore.getState().hydrate();
    expect(useAppStore.getState().legacyRhythm).toEqual({ fullEveryDays: 3, quickEveryDays: 1 });
  });

  it('writes one child rhythm without disturbing another', async () => {
    useAppStore.setState({ bathRhythms: { c2: { fullEveryDays: 7, quickEveryDays: 2 } } });
    useAppStore.getState().setBathRhythm('c1', { fullEveryDays: 1 });
    expect(useAppStore.getState().bathRhythms).toEqual({
      c1: { fullEveryDays: 1, quickEveryDays: 1 },
      c2: { fullEveryDays: 7, quickEveryDays: 2 },
    });
  });

  it('clamps on the way in, so persistence never holds an out-of-range value', () => {
    useAppStore.setState({ bathRhythms: {} });
    useAppStore.getState().setBathRhythm('c1', { fullEveryDays: 900, quickEveryDays: -3 });
    expect(useAppStore.getState().bathRhythms.c1).toEqual({ fullEveryDays: 30, quickEveryDays: 0 });
  });
```

The hydration action is `hydrate`, declared at `src/store/useAppStore.ts:1402`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/store/useAppStore.test.ts`
Expected: FAIL, `legacyRhythm` and `setBathRhythm` do not exist.

- [ ] **Step 4: Implement the store changes**

State declaration, replacing `smallWashesPerBig: number;` at line 172 and its
doc comment at 169-171:

```ts
  /**
   * Bath rhythm per child, keyed by child id. Local only: Baby Buddy has no
   * notion of wash cadence, so this drives the due hints and the log-sheet
   * pre-selection and nothing else. Persisted by src/data/bathRhythm.ts.
   */
  bathRhythms: Record<string, BathRhythm>;
  /**
   * The rhythm used for a child with no stored entry, derived once at hydration
   * from the retired `smallWashesPerBig` pref, or the built-in default when that
   * pref was never written. See `legacyBathRhythm`.
   */
  legacyRhythm: BathRhythm;
  setBathRhythm: (childId: string, patch: Partial<BathRhythm>) => void;
```

Delete the `setSmallWashesPerBig` declaration wherever it sits in the actions
block.

Defaults, replacing `smallWashesPerBig: SMALL_WASHES_PER_BIG_DEFAULT,` at line
1226:

```ts
  bathRhythms: {},
  legacyRhythm: BATH_RHYTHM_DEFAULT,
```

Setter, replacing `setSmallWashesPerBig` at lines 1334-1340:

```ts
  setBathRhythm: (childId, patch) => {
    // Clamp before storing so a bad value can never reach persistence, and so
    // the number shown in Settings is the one the rhythm actually uses. The
    // child's current rhythm is the fallback, so a patch touching one axis
    // cannot reset the other.
    const s = get();
    const current = rhythmForChild(s.bathRhythms, childId, s.legacyRhythm);
    const next = clampBathRhythm({ ...current, ...patch }, current);
    const map = { ...s.bathRhythms, [childId]: next };
    set({ bathRhythms: map });
    void saveBathRhythms(map);
  },
```

Hydration, replacing lines 1425-1429:

```ts
    // The retired per-app rhythm pref, read once to derive the fallback for a
    // child with nothing of their own. `!= null`, not a truthy guard: it is a
    // number and a truthy check would discard a legitimately stored 1.
    set({ legacyRhythm: legacyBathRhythm(prefs.smallWashesPerBig ?? undefined) });
```

and, alongside the other loaders near line 1448:

```ts
    set({ bathRhythms: await loadBathRhythms() });
```

Pre-selection, replacing line 2735:

```ts
      // Pre-select the wash that's due from this child's rhythm. Scoped to the
      // selected child: `entries` holds every child's records, so an unscoped
      // read would let a sibling's baths decide this child's next wash.
      const childId = get().selectedChildId;
      te.wash = washDueState(
        entriesForChild(get().entries, childId),
        rhythmForChild(get().bathRhythms, childId, get().legacyRhythm),
        Date.now(),
      ).nextKind;
```

Update the `@/store/selectors` import: drop `nextWashKind`,
`clampSmallWashesPerBig` and `SMALL_WASHES_PER_BIG_DEFAULT`; add
`washDueState`, `rhythmForChild`, `clampBathRhythm`, `legacyBathRhythm` and
`BATH_RHYTHM_DEFAULT`. Add `import { loadBathRhythms, saveBathRhythms } from '@/data/bathRhythm';`
and `BathRhythm` to the `@/types/models` type import.

- [ ] **Step 5: Refresh the demo seed**

`src/data/seed.ts`, replacing the comment at lines 47-49 and keeping the entries
from Task 1. Under the new default (full every 3 days) a full bath 4 days ago
still reads as due today, so only the comment is wrong:

```ts
      // A bath rhythm mid-cycle: a full bath four days ago, then three quick
      // washes, so a full bath reads as due today at the default rhythm of
      // every three days.
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/store/useAppStore.test.ts && npm test`
Expected: PASS. `npx tsc --noEmit` still reports errors in
`DashboardContent.tsx` and `settings/index.tsx` only.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(bath): move the rhythm out of prefs and onto the child"
```

---

### Task 7: Home tile states

**Files:**
- Modify: `src/features/dashboard/DashboardContent.tsx:63`, `:134-140`
- Test: none directly. `DashboardContent` has no test file; the hint logic it
  calls is covered by Task 5.

**Interfaces:**
- Consumes: `washDueState`, `rhythmForChild` (Task 5); `bathRhythms`,
  `legacyRhythm` (Task 6).

- [ ] **Step 1: Swap the store reads**

`src/features/dashboard/DashboardContent.tsx`, replacing line 63:

```tsx
  const bathRhythms = useAppStore((s) => s.bathRhythms);
  const legacyRhythm = useAppStore((s) => s.legacyRhythm);
```

Both are raw fields, so neither selector allocates. Do NOT combine them into one
selector returning an object literal: that is the zustand v5 infinite-loop trap
that blank-screens the web build.

- [ ] **Step 2: Replace the hint derivation**

Replacing lines 134-140:

```tsx
  // Today's-wash "checked" state: >=1 bath on today's local date. `now`-keyed, so
  // it clears itself at local midnight without any reset logic.
  const washedToday = bathGivenToday(childEntries, now);
  const washDue = washDueState(
    childEntries,
    rhythmForChild(bathRhythms, selectedChild?.id ?? null, legacyRhythm),
    now,
  );
  // Once a wash is logged today the tile switches to the "done" copy. Otherwise
  // it reports what is due, and failing that how long until the next one is. A
  // child with both intervals off has no schedule at all, so it falls back to
  // the same generic copy the tiles with no state use.
  const washHint = washedToday
    ? 'Washed today'
    : washDue.full
      ? 'Full bath due today'
      : washDue.quick
        ? 'Quick wash due'
        : washDue.upcoming
          ? `${washDue.upcoming.kind === 'full' ? 'Full bath' : 'Quick wash'} ${
              washDue.upcoming.inDays === 1 ? 'tomorrow' : `in ${washDue.upcoming.inDays} days`
            }`
          : 'Tap to log';
```

Update the `@/store/selectors` import on line 16: drop `nextWashKind`, add
`washDueState` and `rhythmForChild`.

- [ ] **Step 3: Verify**

Run: `npm test && npx tsc --noEmit`
Expected: PASS on tests. `tsc` now reports errors only in
`src/app/settings/index.tsx`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(bath): report the day-based wash schedule on the Home tile"
```

---

### Task 8: Per-child rhythm settings

**Files:**
- Modify: `src/app/settings/index.tsx:252-253`, `:374-402`
- Test: none. Presentational, over logic covered in Tasks 5 and 6.

**Interfaces:**
- Consumes: `bathRhythms`, `legacyRhythm`, `setBathRhythm` (Task 6);
  `rhythmForChild`, `BATH_INTERVAL_MIN`, `BATH_INTERVAL_MAX` (Task 5); the
  existing local `CountField` at line 114.

- [ ] **Step 1: Swap the store reads**

Replacing lines 252-253:

```tsx
  const children = useAppStore((s) => s.children);
  const bathRhythms = useAppStore((s) => s.bathRhythms);
  const legacyRhythm = useAppStore((s) => s.legacyRhythm);
  const setBathRhythm = useAppStore((s) => s.setBathRhythm);
```

All four are raw fields. Deriving each child's rhythm happens in the render body
below, never inside a selector.

- [ ] **Step 2: Replace the rhythm block**

Replacing lines 377-402, the `<View style={group}>` child that currently holds
the wash rhythm. Everything below it in that group (the nap window) stays where
it is.

```tsx
        {children.map((child) => {
          const rhythm = rhythmForChild(bathRhythms, child.id, legacyRhythm);
          return (
            <View
              key={child.id}
              style={[row, { flexDirection: 'column', alignItems: 'stretch', gap: 11, borderBottomWidth: 1, borderBottomColor: t.line }]}
            >
              <View>
                <Txt weight={600} size={16}>
                  Bath rhythm for {child.first}
                </Txt>
                <Txt weight={500} size={13} color={t.dim} style={{ marginTop: 2 }}>
                  Full bath every {rhythm.fullEveryDays === 1 ? 'day' : `${rhythm.fullEveryDays} days`}, quick wash every{' '}
                  {rhythm.quickEveryDays === 1 ? 'day' : `${rhythm.quickEveryDays} days`}
                </Txt>
              </View>
              <CountField
                label="Full bath, every N days"
                value={rhythm.fullEveryDays}
                min={BATH_INTERVAL_MIN}
                max={BATH_INTERVAL_MAX}
                onCommit={(n) => setBathRhythm(child.id, { fullEveryDays: n })}
              />
              <CountField
                label="Quick wash, every N days"
                value={rhythm.quickEveryDays}
                min={BATH_INTERVAL_MIN}
                max={BATH_INTERVAL_MAX}
                onCommit={(n) => setBathRhythm(child.id, { quickEveryDays: n })}
              />
              <Txt weight={500} size={12} color={t.faint}>
                Type a number or use − and +, anywhere from {BATH_INTERVAL_MIN} to {BATH_INTERVAL_MAX}. Set one to 0 to turn
                that reminder off. The rhythm is read off the baths already logged, so a change shows up straight away in
                what&apos;s due next.
              </Txt>
            </View>
          );
        })}
```

`Child.first` is the display name used everywhere else (`ExpectingCard.tsx:53`,
`MilestoneNudge.tsx:85`); there is no combined-name helper.

The summary line above the steppers reads "every day" rather than "every 1 days".
It does not special-case 0, because a 0 axis reads as "every 0 days" only until
the user commits, and the helper text below states what 0 means.

Update the `@/store/selectors` import: drop `clampSmallWashesPerBig`,
`SMALL_WASHES_PER_BIG_MIN` and `SMALL_WASHES_PER_BIG_MAX`; add `rhythmForChild`,
`BATH_INTERVAL_MIN` and `BATH_INTERVAL_MAX`.

- [ ] **Step 3: Verify**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all PASS, with no remaining references to the deleted symbols.

Run: `grep -rn "smallWashesPerBig\|SMALL_WASHES_PER_BIG\|nextWashKind" src/`
Expected: exactly one hit, the `smallWashesPerBig` field in the `LegacyPrefs`
interface in `src/data/prefs.ts`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(settings): give each child their own bath rhythm in days"
```

---

### Task 9: Server migration script

**Files:**
- Create: `scripts/migrate-bath-tags.mjs`, `scripts/migrate-bath-tags.test.mjs`
- Modify: `vitest.config.ts`

**Interfaces:**
- Produces, exported from `scripts/migrate-bath-tags.mjs` for testing:
  `tagNames(raw)`, `mapTagList(names)`, `mapNoteBody(body)`, `planForNote(note)`.

- [ ] **Step 1: Widen the vitest include**

`vitest.config.ts`:

```ts
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
```

- [ ] **Step 2: Write the failing test**

Create `scripts/migrate-bath-tags.test.mjs`:

```js
import { describe, expect, it } from 'vitest';

import { mapNoteBody, mapTagList, planForNote, tagNames } from './migrate-bath-tags.mjs';

describe('tagNames', () => {
  it('accepts both the object and string tag shapes', () => {
    expect(tagNames([{ name: 'bath' }, 'big'])).toEqual(['bath', 'big']);
    expect(tagNames(undefined)).toEqual([]);
  });
});

describe('mapTagList', () => {
  it('rewrites the size tags', () => {
    expect(mapTagList(['bath', 'small'])).toEqual(['bath', 'bath:quick']);
    expect(mapTagList(['bath', 'big'])).toEqual(['bath', 'bath:full']);
  });

  it('leaves the bath marker and user tags alone, preserving order', () => {
    expect(mapTagList(['bath', 'big', 'Fussy', 'Evening'])).toEqual(['bath', 'bath:full', 'Fussy', 'Evening']);
  });

  it('does not touch a word that merely contains a size name', () => {
    expect(mapTagList(['bath', 'smallish', 'bigger'])).toEqual(['bath', 'smallish', 'bigger']);
  });

  it('drops a duplicate the mapping would create', () => {
    expect(mapTagList(['bath', 'big', 'bath:full'])).toEqual(['bath', 'bath:full']);
  });

  it('is idempotent', () => {
    expect(mapTagList(['bath', 'bath:full', 'Fussy'])).toEqual(['bath', 'bath:full', 'Fussy']);
  });
});

describe('mapNoteBody', () => {
  it('rewrites only a body Budkin generated', () => {
    expect(mapNoteBody('Bath, small wash')).toBe('Quick wash');
    expect(mapNoteBody('Bath, big wash')).toBe('Full bath');
  });

  it('leaves a hand-edited body byte-identical', () => {
    for (const body of ['Bath, big wash. Screamed.', 'bath, big wash', 'Bath', '', 'Full bath']) {
      expect(mapNoteBody(body)).toBe(body);
    }
  });
});

describe('planForNote', () => {
  it('plans a pre-migration bath note', () => {
    const plan = planForNote({ id: 1, note: 'Bath, big wash', tags: ['bath', 'big'] });
    expect(plan).toEqual({
      oldTags: ['bath', 'big'],
      newTags: ['bath', 'bath:full'],
      oldBody: 'Bath, big wash',
      newBody: 'Full bath',
      tagsChanged: true,
      bodyChanged: true,
    });
  });

  // The scoping rule. `small` and `big` are ordinary words that may tag anything.
  it('returns null for a note without the bath tag, even when it carries a size word', () => {
    expect(planForNote({ id: 2, note: 'Bought a big pram', tags: ['small', 'big'] })).toBeNull();
  });

  it('returns null for an already-migrated note', () => {
    expect(planForNote({ id: 3, note: 'Full bath', tags: ['bath', 'bath:full'] })).toBeNull();
  });

  it('plans tags alone when the body was hand-edited', () => {
    const plan = planForNote({ id: 4, note: 'Bath, big wash. Screamed.', tags: ['bath', 'big'] });
    expect(plan.tagsChanged).toBe(true);
    expect(plan.bodyChanged).toBe(false);
    expect(plan.newBody).toBe('Bath, big wash. Screamed.');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run scripts/migrate-bath-tags.test.mjs`
Expected: FAIL, cannot resolve `./migrate-bath-tags.mjs`.

- [ ] **Step 4: Write the script**

Create `scripts/migrate-bath-tags.mjs`. Copy
`scripts/migrate-cure-tags-to-treatment.mjs` and keep its structure verbatim:
`parseArgs`, `apiBase`, `HttpError`, `request`, the paginated fetch with its
`ordering=id` and reported-count reasoning, the `main` reporting loop, and the
`import.meta.url` direct-invocation guard. Change the header comment, drop
`deleteOldTags` and its `--delete-old-tags` flag entirely, and replace the
mapping helpers with these.

Header comment:

```js
#!/usr/bin/env node
/**
 * One-shot Baby Buddy migration: move the bath size tags to the `bath:` prefix.
 *
 * Budkin stores a bath as a Note tagged `bath` plus a size tag. That size tag was
 * a bare `small` or `big` until 2026-08 and is now `bath:quick` / `bath:full`.
 * This script moves the existing server-side records across.
 *
 * What changes, per note carrying the `bath` tag:
 *   tag  `small`            -> `bath:quick`
 *   tag  `big`              -> `bath:full`
 *   body `Bath, small wash` -> `Quick wash`
 *   body `Bath, big wash`   -> `Full bath`
 * The `bath` marker tag, every user tag, and any hand-edited body are left
 * untouched.
 *
 * SCOPING, and why this script is narrower than the cure/treatment one: `small`
 * and `big` are ordinary words that may legitimately tag a feeding, a sleep, or
 * anything else. Only notes that actually carry the `bath` tag are rewritten,
 * re-checked locally rather than trusted from the server filter.
 *
 * The app still READS a bare `big` tag, so a note this script misses keeps
 * reporting the right wash and self-heals on its next edit. The migration is
 * therefore a tidy-up, not a correctness gate.
 *
 * There is deliberately NO --delete-old-tags. In Baby Buddy a tag can attach to
 * feedings, changes, sleeps and more, so proving `small` is unused would mean
 * sweeping every model, and deleting a tag you use elsewhere is not worth the
 * tidiness. Delete them by hand in Baby Buddy's tag admin, where usage is visible.
 *
 * USAGE
 *   Dry run (the default; writes nothing, prints every intended change):
 *     node scripts/migrate-bath-tags.mjs --url=https://bb.example.org --token=abc123
 *
 *   Apply:
 *     node scripts/migrate-bath-tags.mjs --url=... --token=... --apply
 *
 * OPTIONS
 *   --url=<base>     Baby Buddy base URL, with or without a trailing /api.
 *                    Env fallback: BABYBUDDY_URL
 *   --token=<key>    Baby Buddy API token. Env fallback: BABYBUDDY_TOKEN
 *   --apply          Actually write. Without it nothing is sent but GETs.
 *   --page-size=<n>  Notes fetched per request (default 100).
 *   -h, --help       This text.
 *
 * SAFE RUN ORDER
 *   1. Open the CURRENT app on every device while online and let it settle, so
 *      no device is holding a queued write that would land mid-migration.
 *   2. Run in dry-run mode and read the report.
 *   3. Run again with --apply.
 *
 * Re-running is safe: a migrated note no longer carries a bare size tag, so a
 * second run finds nothing. The per-note mapping is idempotent regardless.
 *
 * Plain Node, no dependencies. Needs Node 18+ for global fetch.
 */
```

Constants and mapping helpers, replacing the cure script's equivalents:

```js
const BATH_TAG = 'bath';
const TAG_MAP = { small: 'bath:quick', big: 'bath:full' };
const BODY_MAP = { 'Bath, small wash': 'Quick wash', 'Bath, big wash': 'Full bath' };

/** Baby Buddy returns tags as objects on read and accepts names on write. */
export function tagNames(raw) {
  return (Array.isArray(raw) ? raw : []).map((t) => (typeof t === 'string' ? t : t?.name)).filter((n) => typeof n === 'string');
}

/**
 * Map a whole tag list, preserving order and dropping duplicates the mapping
 * could create (a note already carrying both `big` and `bath:full`). Only an
 * EXACT `small` or `big` is rewritten, so `smallish` and `bigger` survive.
 */
export function mapTagList(names) {
  const out = [];
  for (const n of names) {
    const mapped = TAG_MAP[n] ?? n;
    if (!out.includes(mapped)) out.push(mapped);
  }
  return out;
}

/**
 * Rewrite a note body, but only when it is EXACTLY one Budkin generated. A body
 * someone edited in Baby Buddy comes back byte-identical, because there is no
 * way to rewrite the vocabulary inside it without risking their words.
 */
export function mapNoteBody(body) {
  const text = String(body ?? '');
  return BODY_MAP[text] ?? text;
}

/**
 * The full per-note plan, or null when the note needs nothing.
 *
 * Returns null for any note WITHOUT the `bath` tag, whatever else it carries.
 * That is the whole safety property of this script.
 */
export function planForNote(note) {
  const oldTags = tagNames(note.tags);
  if (!oldTags.includes(BATH_TAG)) return null;
  const newTags = mapTagList(oldTags);
  const oldBody = String(note.note ?? '');
  const newBody = mapNoteBody(oldBody);
  const tagsChanged = newTags.length !== oldTags.length || newTags.some((t, i) => t !== oldTags[i]);
  const bodyChanged = newBody !== oldBody;
  if (!tagsChanged && !bodyChanged) return null;
  return { oldTags, newTags, oldBody, newBody, tagsChanged, bodyChanged };
}
```

In the fetch function, change the filter and the name:

```js
async function fetchAllBathNotes(base, token, pageSize) {
```

with its request path becoming:

```js
    const page = await request(base, token, `/notes/?tags=${encodeURIComponent(BATH_TAG)}&ordering=id&limit=${pageSize}&offset=${offset}`);
```

In `main`, the local re-check that replaces the cure script's
`isOldStructuralTag` guard is simply `planForNote` returning null, so the loop
becomes:

```js
  for (const note of notes) {
    const plan = planForNote(note);
    if (!plan) {
      skipped++;
      continue;
    }
    found++;
    console.log(`note ${note.id}:`);
    if (plan.tagsChanged) {
      console.log(`  tags [${plan.oldTags.join(', ')}]`);
      console.log(`    -> [${plan.newTags.join(', ')}]`);
    }
    if (plan.bodyChanged) {
      console.log(`  body "${plan.oldBody}" -> "${plan.newBody}"`);
    }
    if (!opts.apply) {
      migrated++;
      continue;
    }
    try {
      await request(base, token, `/notes/${note.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ tags: plan.newTags, note: plan.newBody }),
      });
      migrated++;
      console.log('  patched');
    } catch (e) {
      failed++;
      failures.push({ id: note.id, message: e.message });
      console.error(`  FAILED: ${e.message}`);
    }
  }
```

and after the summary block, replacing the cure script's `--delete-old-tags`
section:

```js
  console.log('');
  console.log('The bare `small` and `big` tag objects are left in place. They may');
  console.log('be attached to other records, so delete them in Baby Buddy\'s tag');
  console.log('admin only once you have checked their usage there.');
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run scripts/migrate-bath-tags.test.mjs`
Expected: PASS, 14 tests.

- [ ] **Step 6: Check the script runs and refuses cleanly**

Run: `node scripts/migrate-bath-tags.mjs --help`
Expected: usage text, exit 0.

Run: `node scripts/migrate-bath-tags.mjs`
Expected: "Missing server URL or token.", exit 2.

- [ ] **Step 7: Full verification**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(scripts): migrate Baby Buddy bath tags to the bath: prefix"
```

---

## After the plan

The code change is complete at Task 9, but the server is not migrated. Hand back
to the user with the run instructions rather than running it: it writes to their
live Baby Buddy instance and they said they would run it manually.

```
1. Open Budkin on every device while online, let it settle (drains queued writes)
2. node scripts/migrate-bath-tags.mjs --url=<base> --token=<key>      # dry run
3. node scripts/migrate-bath-tags.mjs --url=<base> --token=<key> --apply
```

Nothing breaks if they never run it: the app reads the legacy `big` tag, and each
bath self-heals to the new tags on its next edit.
