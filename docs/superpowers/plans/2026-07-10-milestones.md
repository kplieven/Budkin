# Milestones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a predefined developmental-milestone checklist that logs each reached milestone as a tagged Baby Buddy note, surfaced in a new "Milestones" segment of the Growth tab.

**Architecture:** Milestones ride on `/api/notes/` exactly like baths, carrying a `milestone` marker tag plus an `mk:<key>` tag. A new `MilestoneEntry` type joins the `Entry` union (and `milestone` joins `ActivityType`, which today equals `Entry['type']`), so the existing create/update/delete/offline-sync machinery works unchanged. Reached-state is derived from the presence of a milestone entry, so nothing extra is stored. The UI is a segmented view on the Growth tab: a catalog grouped by category with an "Around now" section keyed to the child's age.

**Tech Stack:** TypeScript, React Native (Expo SDK 56), expo-router, Zustand v5, Vitest.

## Global Constraints

- Expo SDK 56. Read the versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any Expo/React Native API code.
- No em-dashes (—) or other "AI tells" in code comments, UI copy, or commit messages. Use commas, colons, or separate sentences.
- Offline-first: never bypass the store's write path. New records go through `commitWrite`; edits/deletes go through the existing entry paths (`updateEntryOnServer` / `deleteEntry` / `addPendingOp`).
- Zustand v5 selector rule: never return a fresh reference (no inline `.filter`/`.map`) from a `useAppStore` selector. Select the raw array and derive in render. Violating this blank-screens web routes with "Maximum update depth exceeded."
- Structural tags (`milestone`, `mk:*`) must never appear in the tag picker and must round-trip untouched on the entries that carry them.
- Milestones must never appear in the History timeline or the Notes tab.
- All pure logic gets Vitest unit tests colocated as `*.test.ts`. UI is verified manually via `/verify`.

---

### Task 1: Data model + Baby Buddy encoding

Teach the type system and the API layer about milestones. Adding `milestone` to `ActivityType` (which equals `Entry['type']`) makes several `Record<ActivityType, …>` maps and `switch (entry.type)` blocks non-exhaustive; TypeScript flags each, and this task fills them all so `tsc` is green again. Includes the tagged-note round-trip helpers with tests.

**Files:**
- Modify: `src/types/models.ts` (ActivityType, Entry union, MilestoneEntry, entryTimestamp)
- Modify: `src/lib/activities.ts` (ACTIVITY_LABEL, ACTIVITY_SHAPE, DEFAULT_DURATION_MIN)
- Modify: `src/features/dashboard/DashboardContent.tsx` (ICON_FOR, activityHint)
- Modify: `src/features/activity/detail.ts` (detailFor switch)
- Modify: `src/api/client.ts` (ENDPOINT, buildBody, encoding helpers, isHiddenTag, tag stripping)
- Modify: `src/store/useAppStore.ts` (visibleTags uses isHiddenTag)
- Test: `src/api/client.test.ts` (encoding round-trip)

**Interfaces:**
- Produces:
  - `interface MilestoneEntry` with `type: 'milestone'; key: string; time: number; text: string; note?: string` (extends `EntryBase`, so also `id`, `serverId?`, `childId`, `tags`).
  - `isMilestoneNote(n: any): boolean`
  - `noteToMilestoneEntry(n: any, childId: string): MilestoneEntry`
  - `milestoneToNoteBody(entry: MilestoneEntry): Record<string, unknown>`
  - `isHiddenTag(name: string): boolean`

- [ ] **Step 1: Write the failing encoding tests**

Add to `src/api/client.test.ts`. First extend the import from `@/api/client` to also pull `isMilestoneNote`, `milestoneToNoteBody`, `noteToMilestoneEntry`, `isHiddenTag`, and extend the `@/types/models` import to include `MilestoneEntry`. Then append:

```ts
describe('milestone note serialization', () => {
  const MS: MilestoneEntry = {
    id: 'e1',
    childId: '5',
    type: 'milestone',
    key: 'first-steps',
    time: TIME,
    text: 'First steps',
    note: 'took three',
    tags: ['proud'],
  };

  it('isMilestoneNote is true only when the milestone tag is present', () => {
    expect(isMilestoneNote({ tags: ['milestone', 'mk:first-steps'] })).toBe(true);
    expect(isMilestoneNote({ tags: ['bath', 'small'] })).toBe(false);
    expect(isMilestoneNote({ tags: [] })).toBe(false);
    expect(isMilestoneNote({})).toBe(false);
  });

  it('milestoneToNoteBody writes the structural tags, keeps user tags, two-line body', () => {
    const body = milestoneToNoteBody(MS);
    expect(body.child).toBe('5');
    expect(body.note).toBe('🎉 First steps\ntook three');
    expect(body.tags).toEqual(['milestone', 'mk:first-steps', 'proud']);
  });

  it('milestoneToNoteBody omits the second line when there is no note', () => {
    const body = milestoneToNoteBody({ ...MS, note: undefined });
    expect(body.note).toBe('🎉 First steps');
    expect(body.tags).toEqual(['milestone', 'mk:first-steps', 'proud']);
  });

  it('round-trips key, time, note, and user tags; drops structural tags', () => {
    const server = { id: 42, time: '2026-03-04T18:30:00.000Z', note: '🎉 First steps\ntook three', tags: ['milestone', 'mk:first-steps', 'proud'] };
    const back = noteToMilestoneEntry(server, '5');
    expect(back).toEqual({
      id: 'milestone-42',
      serverId: 42,
      childId: '5',
      type: 'milestone',
      key: 'first-steps',
      time: TIME,
      text: 'First steps',
      note: 'took three',
      tags: ['proud'],
    });
  });

  it('recovers a milestone with no user note (single body line)', () => {
    const server = { id: 7, time: '2026-03-04T18:30:00.000Z', note: '🎉 First word', tags: ['milestone', 'mk:first-word'] };
    const back = noteToMilestoneEntry(server, '5');
    expect(back.key).toBe('first-word');
    expect(back.text).toBe('First word');
    expect(back.note).toBeUndefined();
    expect(back.tags).toEqual([]);
  });

  it('isHiddenTag hides structural milestone tags but not user tags', () => {
    expect(isHiddenTag('milestone')).toBe(true);
    expect(isHiddenTag('mk:first-steps')).toBe(true);
    expect(isHiddenTag('bath')).toBe(true);
    expect(isHiddenTag('proud')).toBe(false);
  });

  it('noteToNoteBody strips milestone structural tags from a general note', () => {
    const note: NoteEntry = { id: 'n1', childId: '5', type: 'note', time: TIME, text: 'hi', tags: ['milestone', 'mk:x', 'keep'] };
    expect((noteToNoteBody(note).tags as string[])).toEqual(['keep']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/api/client.test.ts`
Expected: FAIL. Import errors / "isMilestoneNote is not a function" etc.

- [ ] **Step 3: Add the `MilestoneEntry` type and extend the unions**

In `src/types/models.ts`:

Change the `ActivityType` line (line 9) to add `milestone`:

```ts
export type ActivityType = 'feeding' | 'sleep' | 'diaper' | 'pumping' | 'tummy' | 'bath' | 'temperature' | 'note' | 'milestone';
```

Add the interface after `NoteEntry` (after line 145):

```ts
/**
 * A reached developmental milestone (e.g. "first steps"). Baby Buddy has no
 * milestone resource, so like a bath this is stored as a tagged Note: a
 * `milestone` marker tag plus an `mk:<key>` tag naming which one. Point event.
 * Surfaces only in the Growth & Development milestone checklist, never in the
 * History timeline or the Notes tab. `key` is the catalog key; `text` is a
 * display-title snapshot; `note` is the parent's optional free-text line.
 */
export interface MilestoneEntry extends EntryBase {
  type: 'milestone';
  key: string;
  time: number;
  text: string;
  note?: string;
}
```

Add `MilestoneEntry` to the `Entry` union (after `NoteEntry` on line 154):

```ts
export type Entry =
  | FeedingEntry
  | SleepEntry
  | DiaperEntry
  | PumpingEntry
  | TummyEntry
  | BathEntry
  | TemperatureEntry
  | NoteEntry
  | MilestoneEntry;
```

Update `entryTimestamp` (lines 160-164) so milestone resolves via `time`:

```ts
export function entryTimestamp(e: Entry): number {
  return e.type === 'diaper' || e.type === 'bath' || e.type === 'temperature' || e.type === 'note' || e.type === 'milestone'
    ? e.time
    : (e.end ?? e.start);
}
```

Leave `POINT_ACTIVITIES` unchanged: it is not referenced anywhere milestones flow through, and milestones never use the generic log sheet.

- [ ] **Step 4: Fill the compiler-flagged activity maps**

In `src/lib/activities.ts`, add a `milestone` key to each of the three `Record<ActivityType, …>` maps. Do NOT add it to `ALL_ACTIVITIES` or `TIMER_SAVE_OPTIONS` (that keeps it out of the log-sheet grid and timer options):

```ts
// in ACTIVITY_LABEL:
  milestone: 'Milestone',
// in ACTIVITY_SHAPE:
  milestone: 'point',
// in DEFAULT_DURATION_MIN:
  milestone: 0,
```

In `src/features/dashboard/DashboardContent.tsx`, add `milestone` to the two `Record<ActivityType, …>` maps. Both are only completeness placeholders since milestone is never in `ALL_ACTIVITIES`, so it never renders a tile:

```ts
// in ICON_FOR (mirror the existing note placeholder):
  milestone: 'note',
// in activityHint:
  milestone: 'Tap to log',
```

In `src/features/activity/detail.ts`, add a case to the `detailFor` switch so it stays exhaustive (milestones are not shown in the timeline, but the switch must be total):

```ts
    case 'milestone':
      return e.text;
```

- [ ] **Step 5: Add the encoding helpers to the API client**

In `src/api/client.ts`, just below the bath helpers block (after `HIDDEN_TAGS`, around line 145), add milestone structural-tag helpers and the hidden-tag predicate:

```ts
// --- milestone <-> Baby Buddy Note (tagged-note) serialization ---
// Baby Buddy has no milestone resource, so a reached milestone is a Note tagged
// `milestone` (marker) + `mk:<key>` (which one). Same pattern as baths.
const isStructuralMilestoneTag = (t: string): boolean => t === 'milestone' || t.startsWith('mk:');

/** True for any tag the picker must never surface or let the user create:
 *  the bath/side structural tags plus the milestone marker and mk:<key> tags. */
export function isHiddenTag(name: string): boolean {
  return HIDDEN_TAGS.has(name) || isStructuralMilestoneTag(name);
}

/** The single discriminator: a milestone note carries the `milestone` tag. */
export function isMilestoneNote(n: any): boolean {
  return tagNames(n?.tags).includes('milestone');
}

/** Encode a milestone entry as the body for a Baby Buddy Note (create/update).
 *  Body is `🎉 <title>` with the optional parent note on a second line. */
export function milestoneToNoteBody(entry: MilestoneEntry): Record<string, unknown> {
  const userTags = entry.tags.filter((t) => !isStructuralMilestoneTag(t));
  const note = entry.note?.trim();
  return {
    child: entry.childId,
    time: toISO(entry.time),
    note: note ? `🎉 ${entry.text}\n${note}` : `🎉 ${entry.text}`,
    tags: ['milestone', `mk:${entry.key}`, ...userTags],
  };
}

/** Reconstruct a milestone entry from a Baby Buddy Note carrying the `milestone`
 *  tag. `key` comes from the mk:<key> tag; the body's first line (emoji stripped)
 *  is the title snapshot and any later lines are the parent note. */
export function noteToMilestoneEntry(n: any, childId: string): MilestoneEntry {
  const tags = tagNames(n.tags);
  const keyTag = tags.find((t) => t.startsWith('mk:'));
  const lines = String(n.note ?? '').split('\n');
  const title = (lines[0] ?? '').replace(/^🎉\s*/, '').trim();
  const rest = lines.slice(1).join('\n').trim();
  return {
    id: `milestone-${n.id}`,
    serverId: n.id,
    childId,
    type: 'milestone',
    key: keyTag ? keyTag.slice(3) : '',
    time: fromISO(n.time),
    text: title,
    note: rest || undefined,
    tags: tags.filter((t) => !isStructuralMilestoneTag(t)),
  };
}
```

Import `MilestoneEntry` in the `@/types/models` import block at the top of the file (add it alphabetically near `NoteEntry`).

Add the `milestone` endpoint to the `ENDPOINT` map (around line 119):

```ts
  note: 'notes',
  milestone: 'notes',
```

Add the `buildBody` case (in the `switch (entry.type)` around line 573):

```ts
      case 'milestone':
        return milestoneToNoteBody(entry);
```

Strip milestone structural tags in `noteToNoteBody` (general notes) so a milestone tag can never survive onto a general note. Change its `tags` line to:

```ts
    tags: entry.tags.filter((t) => !BATH_STRUCTURAL_TAGS.includes(t) && !isStructuralMilestoneTag(t)),
```

And in `bathToNoteBody`, extend the `userTags` filter likewise:

```ts
  const userTags = entry.tags.filter((t) => !BATH_STRUCTURAL_TAGS.includes(t) && !isStructuralMilestoneTag(t));
```

- [ ] **Step 6: Route the tag picker through `isHiddenTag`**

In `src/store/useAppStore.ts`, the `visibleTags` helper filters with `HIDDEN_TAGS.has(...)`. Import `isHiddenTag` from `@/api/client` (extend the existing import) and replace both `HIDDEN_TAGS.has(tag.name)` / `HIDDEN_TAGS.has(name)` checks with `isHiddenTag(tag.name)` / `isHiddenTag(name)`. This hides milestone tags from the picker.

- [ ] **Step 7: Run the tests and typecheck**

Run: `npx vitest run src/api/client.test.ts && npx tsc --noEmit`
Expected: PASS. All new tests green; `tsc` reports no errors (every exhaustive map/switch now handles `milestone`).

- [ ] **Step 8: Commit**

```bash
git add src/types/models.ts src/lib/activities.ts src/features/dashboard/DashboardContent.tsx src/features/activity/detail.ts src/api/client.ts src/store/useAppStore.ts src/api/client.test.ts
git commit -m "feat(milestones): MilestoneEntry type + tagged-note encoding"
```

---

### Task 2: Three-way note partition on read

`/api/notes/` now carries three shapes: milestones, baths, and general notes. Split them in `listChildNotes` and thread milestones into the store's `entries` via the repository.

**Files:**
- Modify: `src/api/client.ts` (`listChildNotes` return type + partition)
- Modify: `src/data/repository.ts` (spread milestones into entries)
- Test: `src/api/client.test.ts` (partition)

**Interfaces:**
- Consumes: `isMilestoneNote`, `noteToMilestoneEntry` (Task 1).
- Produces: `listChildNotes(childId, limit?): Promise<{ baths: BathEntry[]; milestones: MilestoneEntry[]; notes: NoteEntry[] }>`.

- [ ] **Step 1: Write the failing partition test**

Add to `src/api/client.test.ts`:

```ts
describe('listChildNotes three-way partition', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('splits milestones, baths, and general notes from one fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        count: 3,
        next: null,
        previous: null,
        results: [
          { id: 1, time: '2026-03-04T18:30:00.000Z', note: '🎉 First steps', tags: ['milestone', 'mk:first-steps'] },
          { id: 2, time: '2026-03-04T18:00:00.000Z', note: 'Bath — small wash', tags: ['bath', 'small'] },
          { id: 3, time: '2026-03-04T17:00:00.000Z', note: 'plain note', tags: [] },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new BabybuddyClient('https://example.com', 'tok');
    const { baths, milestones, notes } = await client.listChildNotes('5');
    expect(milestones.map((m) => m.key)).toEqual(['first-steps']);
    expect(baths.map((b) => b.wash)).toEqual(['small']);
    expect(notes.map((n) => n.text)).toEqual(['plain note']);
  });

  it('classifies a note carrying both milestone and bath tags as a milestone', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        count: 1,
        next: null,
        previous: null,
        results: [{ id: 9, time: '2026-03-04T18:30:00.000Z', note: '🎉 First bath', tags: ['milestone', 'mk:first-bath', 'bath'] }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new BabybuddyClient('https://example.com', 'tok');
    const { baths, milestones } = await client.listChildNotes('5');
    expect(milestones).toHaveLength(1);
    expect(baths).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/api/client.test.ts -t "three-way"`
Expected: FAIL. `milestones` is undefined (destructuring a property that does not exist).

- [ ] **Step 3: Update `listChildNotes`**

In `src/api/client.ts`, change the method (around line 507) to partition three ways. Check `milestone` first so a note with both tags classifies as a milestone:

```ts
  async listChildNotes(
    childId: string,
    limit = 100,
  ): Promise<{ baths: BathEntry[]; milestones: MilestoneEntry[]; notes: NoteEntry[] }> {
    const data = await this.request<Paginated<any>>(
      `/notes/?child=${childId}&ordering=-time&limit=${limit}`,
    );
    const baths: BathEntry[] = [];
    const milestones: MilestoneEntry[] = [];
    const notes: NoteEntry[] = [];
    for (const n of data.results) {
      if (isMilestoneNote(n)) milestones.push(noteToMilestoneEntry(n, childId));
      else if (isBathNote(n)) baths.push(noteToBathEntry(n, childId));
      else notes.push(noteToNoteEntry(n, childId));
    }
    return { baths, milestones, notes };
  }
```

Update the doc comment above it to mention the three-way split.

- [ ] **Step 4: Thread milestones through the repository**

In `src/data/repository.ts`, update the `catch` fallback and the spread (lines 68 and 71):

```ts
      // ONE /api/notes/ request, partitioned into milestones + baths + general notes.
      client.listChildNotes(selectedChildId).catch(() => ({ baths: [], milestones: [], notes: [] })),
```

```ts
    entries = [...f, ...s, ...d, ...p, ...tt, ...notesData.baths, ...notesData.milestones, ...notesData.notes, ...temp];
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/api/client.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/api/client.ts src/data/repository.ts src/api/client.test.ts
git commit -m "feat(milestones): partition /api/notes/ into milestones, baths, notes"
```

---

### Task 3: Milestone catalog + helpers + age

The static catalog and the pure functions the UI reads (reached-state, around-now, grouping), plus an `ageMonths` formatter.

**Files:**
- Create: `src/lib/milestones.ts`
- Create: `src/lib/milestones.test.ts`
- Modify: `src/lib/format.ts` (add `ageMonths`)
- Modify: `src/lib/format.test.ts` (test `ageMonths`)

**Interfaces:**
- Consumes: `MilestoneEntry` (Task 1).
- Produces:
  - `type MilestoneCategory` and `interface MilestoneDef { key; title; category; minMonths; maxMonths }`
  - `MILESTONES: MilestoneDef[]`, `MILESTONE_BY_KEY: Record<string, MilestoneDef>`, `MILESTONE_CATEGORIES: MilestoneCategory[]`
  - `reachedByKey(entries: Entry[]): Map<string, MilestoneEntry>`
  - `aroundNow(ageMonths: number | null, reached: Map<string, MilestoneEntry>): MilestoneDef[]`
  - `groupByCategory(defs: MilestoneDef[]): { category: MilestoneCategory; items: MilestoneDef[] }[]`
  - `ageMonths(birth: number, now: number): number` (in format.ts)

- [ ] **Step 1: Write the failing catalog tests**

Create `src/lib/milestones.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { MILESTONES, MILESTONE_BY_KEY, aroundNow, groupByCategory, reachedByKey } from '@/lib/milestones';
import type { Entry, MilestoneEntry } from '@/types/models';

function ms(key: string, time: number): MilestoneEntry {
  return { id: `e-${key}`, childId: '5', type: 'milestone', key, time, text: key, tags: [] };
}

describe('catalog integrity', () => {
  it('has unique keys and min <= max ranges', () => {
    const keys = MILESTONES.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const m of MILESTONES) expect(m.minMonths).toBeLessThanOrEqual(m.maxMonths);
  });

  it('indexes every def by key', () => {
    for (const m of MILESTONES) expect(MILESTONE_BY_KEY[m.key]).toBe(m);
  });
});

describe('reachedByKey', () => {
  it('maps keys to entries, earliest time wins on duplicates', () => {
    const entries: Entry[] = [ms('first-steps', 2000), ms('first-steps', 1000), ms('first-word', 5000)];
    const map = reachedByKey(entries);
    expect(map.size).toBe(2);
    expect(map.get('first-steps')?.time).toBe(1000);
  });

  it('ignores non-milestone entries', () => {
    const entries = [{ id: 'n', childId: '5', type: 'note', time: 1, text: 'x', tags: [] }] as Entry[];
    expect(reachedByKey(entries).size).toBe(0);
  });
});

describe('aroundNow', () => {
  const reached = reachedByKey([ms('rolls-over', 1)]);

  it('includes not-yet-reached defs whose range contains the age (inclusive bounds)', () => {
    // sits-unassisted is 5-8 months
    const keys = aroundNow(5, reached).map((d) => d.key);
    expect(keys).toContain('sits-unassisted');
    const keys8 = aroundNow(8, reached).map((d) => d.key);
    expect(keys8).toContain('sits-unassisted');
  });

  it('excludes already-reached milestones', () => {
    // rolls-over is 4-6 months but already reached
    expect(aroundNow(5, reached).map((d) => d.key)).not.toContain('rolls-over');
  });

  it('returns empty when age is null', () => {
    expect(aroundNow(null, reached)).toEqual([]);
  });
});

describe('groupByCategory', () => {
  it('preserves category order and omits empty categories', () => {
    const subset = MILESTONES.filter((m) => m.key === 'first-steps' || m.key === 'first-word');
    const groups = groupByCategory(subset);
    expect(groups.map((g) => g.category)).toEqual(['Movement', 'Communication']);
    expect(groups[0].items.map((i) => i.key)).toEqual(['first-steps']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/milestones.test.ts`
Expected: FAIL. Cannot find module `@/lib/milestones`.

- [ ] **Step 3: Write the catalog module**

Create `src/lib/milestones.ts`:

```ts
import type { Entry, MilestoneEntry } from '@/types/models';

export type MilestoneCategory =
  | 'Movement'
  | 'Hands & play'
  | 'Communication'
  | 'Social & emotional'
  | 'Feeding & firsts';

export interface MilestoneDef {
  /** stable key; the mk:<key> tag */
  key: string;
  title: string;
  category: MilestoneCategory;
  /** typical age range in months, inclusive */
  minMonths: number;
  maxMonths: number;
}

/** Category display order. */
export const MILESTONE_CATEGORIES: MilestoneCategory[] = [
  'Movement',
  'Hands & play',
  'Communication',
  'Social & emotional',
  'Feeding & firsts',
];

/** The predefined catalog. Age ranges are gentle typical windows, never a
 *  pass/fail bar. Order within a category is roughly developmental. */
export const MILESTONES: MilestoneDef[] = [
  { key: 'lifts-head', title: 'Lifts head', category: 'Movement', minMonths: 1, maxMonths: 3 },
  { key: 'rolls-over', title: 'Rolls over', category: 'Movement', minMonths: 4, maxMonths: 6 },
  { key: 'sits-unassisted', title: 'Sits unassisted', category: 'Movement', minMonths: 5, maxMonths: 8 },
  { key: 'crawls', title: 'Crawls', category: 'Movement', minMonths: 7, maxMonths: 10 },
  { key: 'pulls-to-stand', title: 'Pulls to stand', category: 'Movement', minMonths: 8, maxMonths: 11 },
  { key: 'cruises', title: 'Cruises furniture', category: 'Movement', minMonths: 9, maxMonths: 12 },
  { key: 'stands-alone', title: 'Stands alone', category: 'Movement', minMonths: 10, maxMonths: 14 },
  { key: 'first-steps', title: 'First steps', category: 'Movement', minMonths: 9, maxMonths: 15 },
  { key: 'grasps-toy', title: 'Grasps a toy', category: 'Hands & play', minMonths: 3, maxMonths: 5 },
  { key: 'passes-toy', title: 'Passes toy hand to hand', category: 'Hands & play', minMonths: 5, maxMonths: 7 },
  { key: 'pincer-grasp', title: 'Pincer grasp', category: 'Hands & play', minMonths: 8, maxMonths: 12 },
  { key: 'stacks-blocks', title: 'Stacks blocks', category: 'Hands & play', minMonths: 12, maxMonths: 18 },
  { key: 'coos', title: 'Coos', category: 'Communication', minMonths: 2, maxMonths: 4 },
  { key: 'first-laugh', title: 'First laugh', category: 'Communication', minMonths: 3, maxMonths: 5 },
  { key: 'babbles', title: 'Babbles', category: 'Communication', minMonths: 4, maxMonths: 7 },
  { key: 'responds-to-name', title: 'Responds to name', category: 'Communication', minMonths: 6, maxMonths: 9 },
  { key: 'waves-bye', title: 'Waves bye-bye', category: 'Communication', minMonths: 9, maxMonths: 12 },
  { key: 'first-word', title: 'First word', category: 'Communication', minMonths: 9, maxMonths: 14 },
  { key: 'points', title: 'Points at things', category: 'Communication', minMonths: 9, maxMonths: 14 },
  { key: 'first-smile', title: 'First smile', category: 'Social & emotional', minMonths: 1, maxMonths: 3 },
  { key: 'peekaboo', title: 'Enjoys peekaboo', category: 'Social & emotional', minMonths: 5, maxMonths: 9 },
  { key: 'stranger-awareness', title: 'Stranger awareness', category: 'Social & emotional', minMonths: 6, maxMonths: 10 },
  { key: 'shows-affection', title: 'Shows affection', category: 'Social & emotional', minMonths: 9, maxMonths: 15 },
  { key: 'first-solid', title: 'First solid food', category: 'Feeding & firsts', minMonths: 4, maxMonths: 6 },
  { key: 'first-tooth', title: 'First tooth', category: 'Feeding & firsts', minMonths: 4, maxMonths: 10 },
  { key: 'finger-feeds', title: 'Finger-feeds self', category: 'Feeding & firsts', minMonths: 8, maxMonths: 12 },
  { key: 'drinks-from-cup', title: 'Drinks from a cup', category: 'Feeding & firsts', minMonths: 9, maxMonths: 15 },
];

export const MILESTONE_BY_KEY: Record<string, MilestoneDef> = Object.fromEntries(
  MILESTONES.map((m) => [m.key, m]),
);

/** Map of catalog key -> the milestone entry that recorded it. On the off chance
 *  of duplicates for one key, the earliest reached time wins. */
export function reachedByKey(entries: Entry[]): Map<string, MilestoneEntry> {
  const map = new Map<string, MilestoneEntry>();
  for (const e of entries) {
    if (e.type !== 'milestone') continue;
    const prev = map.get(e.key);
    if (!prev || e.time < prev.time) map.set(e.key, e);
  }
  return map;
}

/** Not-yet-reached milestones whose typical range spans the child's current age
 *  (in whole months). Empty when age is unknown. */
export function aroundNow(ageMonths: number | null, reached: Map<string, MilestoneEntry>): MilestoneDef[] {
  if (ageMonths == null) return [];
  return MILESTONES.filter(
    (m) => !reached.has(m.key) && ageMonths >= m.minMonths && ageMonths <= m.maxMonths,
  );
}

/** Group defs by category in `MILESTONE_CATEGORIES` order, omitting empties. */
export function groupByCategory(defs: MilestoneDef[]): { category: MilestoneCategory; items: MilestoneDef[] }[] {
  return MILESTONE_CATEGORIES.map((category) => ({
    category,
    items: defs.filter((d) => d.category === category),
  })).filter((g) => g.items.length > 0);
}
```

- [ ] **Step 4: Run the catalog tests**

Run: `npx vitest run src/lib/milestones.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `ageMonths` test**

Add to `src/lib/format.test.ts` (extend the import from `@/lib/format` to include `ageMonths`):

```ts
describe('ageMonths', () => {
  const DAY = 86400000;
  it('returns whole months elapsed since birth', () => {
    const birth = Date.parse('2025-01-01T00:00:00Z');
    expect(ageMonths(birth, birth)).toBe(0);
    expect(ageMonths(birth, birth + 200 * DAY)).toBe(6); // 200 / 30.4 = 6.5 -> 6
  });
  it('never returns negative for a future birth', () => {
    const birth = Date.parse('2025-01-01T00:00:00Z');
    expect(ageMonths(birth, birth - 10 * DAY)).toBe(0);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/lib/format.test.ts -t ageMonths`
Expected: FAIL. `ageMonths is not a function`.

- [ ] **Step 7: Add `ageMonths` to format.ts**

In `src/lib/format.ts`, after `ageStr` (line 55), add:

```ts
/** Whole months of age, matching ageStr's 30.4-day month. Floored, never negative. */
export function ageMonths(birth: number, now: number): number {
  return Math.max(0, Math.floor((now - birth) / 86400000 / 30.4));
}
```

- [ ] **Step 8: Run tests**

Run: `npx vitest run src/lib/format.test.ts src/lib/milestones.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/milestones.ts src/lib/milestones.test.ts src/lib/format.ts src/lib/format.test.ts
git commit -m "feat(milestones): catalog data, helpers, and ageMonths"
```

---

### Task 4: Store actions to log and edit a milestone

Two thin actions over the existing entry create/update machinery. Remove reuses the existing `deleteEntry`, so no new delete action is needed.

**Files:**
- Modify: `src/store/useAppStore.ts` (types block + action implementations)
- Test: `src/store/useAppStore.test.ts`

**Interfaces:**
- Consumes: `commitWrite`, `deleteEntry`, `updateEntryOnServer`, `addPendingOp`, `MILESTONE_BY_KEY`.
- Produces on the store:
  - `logMilestone(key: string, dateMs: number, note?: string): void`
  - `editMilestone(id: string, dateMs: number, note?: string): void`

- [ ] **Step 1: Write the failing store test**

Look at an existing test in `src/store/useAppStore.test.ts` to match how the store is imported. Add `MilestoneEntry` to the `@/types/models` import in the test. Each test seeds its own state so they are order-independent:

```ts
describe('milestone store actions', () => {
  it('logMilestone prepends a milestone entry with the catalog title and empty user tags', () => {
    useAppStore.setState({ selectedChildId: '5', entries: [], connection: null });
    useAppStore.getState().logMilestone('first-steps', 1_000_000, 'took three');
    const e = useAppStore.getState().entries[0];
    expect(e.type).toBe('milestone');
    expect(e).toMatchObject({ key: 'first-steps', text: 'First steps', note: 'took three', time: 1_000_000, childId: '5', tags: [] });
  });

  it('editMilestone updates date and note in place', () => {
    const existing: MilestoneEntry = { id: 'e-x', childId: '5', type: 'milestone', key: 'first-word', time: 1, text: 'First word', note: 'a', tags: [] };
    useAppStore.setState({ selectedChildId: '5', entries: [existing], connection: null });
    useAppStore.getState().editMilestone('e-x', 2_000_000, undefined);
    const e = useAppStore.getState().entries.find((x) => x.id === 'e-x');
    expect(e).toMatchObject({ time: 2_000_000, note: undefined });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/store/useAppStore.test.ts -t "milestone store"`
Expected: FAIL. `logMilestone is not a function`.

- [ ] **Step 3: Declare the actions in the `AppActions` interface**

In `src/store/useAppStore.ts`, near the other entry actions (around `deleteEntry` on line 216), add to the interface:

```ts
  /** Record a reached milestone as a tagged note (create). */
  logMilestone: (key: string, dateMs: number, note?: string) => void;
  /** Edit a reached milestone's date/note. Remove uses deleteEntry(id). */
  editMilestone: (id: string, dateMs: number, note?: string) => void;
```

- [ ] **Step 4: Implement the actions**

Add `MILESTONE_BY_KEY` to the `@/lib/milestones` import (create the import). Implement the actions next to `deleteEntry` (after line 1320). The create path mirrors `save()`'s non-existing branch (prepend + `commitWrite`); the edit path mirrors `save()`'s existing branch (map + `updateEntryOnServer` / offline `addPendingOp`):

```ts
  logMilestone: (key, dateMs, note) => {
    const s = get();
    const childId = s.selectedChildId;
    if (!childId) return;
    const entry: MilestoneEntry = {
      id: 'e' + Date.now(),
      childId,
      type: 'milestone',
      key,
      time: dateMs,
      text: MILESTONE_BY_KEY[key]?.title ?? key,
      note: note?.trim() || undefined,
      tags: [],
    };
    set({ entries: [entry, ...s.entries] });
    get().commitWrite(entry);
    const queued = s.offline && !!s.connection && s.connection.mode === 'server';
    get().showToast(queued ? 'Milestone saved · queued offline' : 'Milestone reached');
  },
  editMilestone: (id, dateMs, note) => {
    const s = get();
    const existing = s.entries.find((e) => e.id === id);
    if (!existing || existing.type !== 'milestone') return;
    const entry: MilestoneEntry = { ...existing, time: dateMs, note: note?.trim() || undefined };
    set({ entries: s.entries.map((e) => (e.id === id ? entry : e)) });
    get().showToast('Updated');
    if (s.connection && s.connection.mode === 'server' && !s.offline) {
      void updateEntryOnServer(s.connection, entry).catch(() => {});
    } else if (s.connection && s.connection.mode === 'server' && s.offline && entry.serverId != null) {
      void addPendingOp({ op: 'update', entity: 'entry', payload: entry });
    }
  },
```

Add `MilestoneEntry` to the `@/types/models` import block if not already present.

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/store/useAppStore.test.ts -t "milestone store" && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/store/useAppStore.ts src/store/useAppStore.test.ts
git commit -m "feat(milestones): store actions logMilestone and editMilestone"
```

---

### Task 5: Growth "& Development" segment + milestone catalog view (read-only)

Add the segmented control to the Growth tab and the catalog view that renders progress, the "Around now" section, and the grouped checklist. Rows are display-only in this task; tapping is wired in Task 6.

**Files:**
- Modify: `src/app/(tabs)/growth.tsx` (heading + segment; render Measurements or MilestonesView)
- Create: `src/features/milestones/MilestonesView.tsx`
- Create: `src/features/milestones/MilestoneRow.tsx`

**Interfaces:**
- Consumes: `MILESTONES`, `groupByCategory`, `aroundNow`, `reachedByKey`, `MilestoneDef` (Task 3); `ageMonths` (Task 3); store `entries`, `now`, `children`, `selectedChildId`.
- Produces: `<MilestonesView />` (no props; manages its own state and derives from the store) and `<MilestoneRow def reachedAt onPress />`. In this task `MilestonesView`'s row-tap handlers are internal stubs; Task 6 replaces them with the sheet.

- [ ] **Step 1: Build the milestone row**

Create `src/features/milestones/MilestoneRow.tsx`:

```tsx
import { Pressable, View } from 'react-native';

import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { useTheme } from '@/theme/useTheme';
import type { MilestoneDef } from '@/lib/milestones';

function reachedDateLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function MilestoneRow({
  def,
  reachedAt,
  onPress,
}: {
  def: MilestoneDef;
  /** epoch ms if reached, else null */
  reachedAt: number | null;
  onPress: () => void;
}) {
  const t = useTheme();
  const color = t.activity.note;
  const reached = reachedAt != null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ checked: reached }}
      accessibilityLabel={reached ? `${def.title}, reached` : `${def.title}, not yet reached`}
      style={(s) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 12,
          paddingHorizontal: 14,
          backgroundColor: t.surface,
          borderWidth: 1.5,
          borderColor: reached ? hexA(color, 0.4) : t.line,
          borderRadius: 16,
          cursor: 'pointer',
        },
        isHovered(s) && { borderColor: hexA(color, 0.6) },
      ]}
    >
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 999,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: reached ? color : 'transparent',
          borderWidth: reached ? 0 : 2,
          borderColor: t.line2,
        }}
      >
        {reached ? <Icon name="check" color={t.onActivity} size={16} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Txt weight={700} size={15} color={t.text}>
          {def.title}
        </Txt>
        <Txt weight={500} size={12.5} color={t.faint} style={{ marginTop: 1 }}>
          {reached ? reachedDateLabel(reachedAt as number) : `typ. ${def.minMonths}-${def.maxMonths} mo`}
        </Txt>
      </View>
    </Pressable>
  );
}
```

Note: confirm `t.activity.note` and the icon name `check` exist (they are used by `notes.tsx` and elsewhere). If the check glyph has a different name in `src/components/Icon.tsx`, use that name.

- [ ] **Step 2: Verify the icon and theme tokens exist**

Run: `grep -n "check\b" src/components/Icon.tsx && grep -n "note:" src/theme/tokens.ts`
Expected: a `check` icon entry and an `activity.note` color. If `check` is absent, pick the nearest existing check/tick icon name and use it in MilestoneRow.

- [ ] **Step 3: Build the catalog view**

Create `src/features/milestones/MilestonesView.tsx`:

```tsx
import { useState } from 'react';
import { View } from 'react-native';

import { Txt } from '@/components/Txt';
import { ageMonths } from '@/lib/format';
import { MILESTONES, aroundNow, groupByCategory, reachedByKey } from '@/lib/milestones';
import type { MilestoneDef } from '@/lib/milestones';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';
import type { MilestoneEntry } from '@/types/models';

import { MilestoneRow } from './MilestoneRow';

function SectionLabel({ text }: { text: string }) {
  const t = useTheme();
  return (
    <Txt weight={700} size={12.5} color={t.faint} tracking={0.8} style={{ marginHorizontal: 4, marginBottom: 8, textTransform: 'uppercase' }}>
      {text}
    </Txt>
  );
}

export function MilestonesView() {
  const t = useTheme();
  // Select raw arrays and derive in render (never return a fresh ref from a selector).
  const entries = useAppStore((s) => s.entries);
  const now = useAppStore((s) => s.now);
  const child = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId));

  // Task 6 replaces these stubs with sheet open handlers.
  const [, setPending] = useState<{ mode: 'log'; def: MilestoneDef } | { mode: 'edit'; entry: MilestoneEntry } | null>(null);
  const onLog = (def: MilestoneDef) => setPending({ mode: 'log', def });
  const onEdit = (entry: MilestoneEntry) => setPending({ mode: 'edit', entry });

  const reached = reachedByKey(entries);
  const months = child ? ageMonths(child.birth, now) : null;
  const upcoming = aroundNow(months, reached);
  const groups = groupByCategory(MILESTONES);

  if (!child) {
    return (
      <View style={{ alignItems: 'center', paddingVertical: 56, paddingHorizontal: 24, gap: 10 }}>
        <Txt weight={700} size={18}>
          No child selected
        </Txt>
        <Txt weight={500} size={14} color={t.dim} style={{ textAlign: 'center', maxWidth: 260, lineHeight: 20 }}>
          Pick a child to browse and log developmental milestones.
        </Txt>
      </View>
    );
  }

  const renderRow = (def: MilestoneDef) => {
    const hit = reached.get(def.key);
    return (
      <MilestoneRow
        key={def.key}
        def={def}
        reachedAt={hit ? hit.time : null}
        onPress={() => (hit ? onEdit(hit) : onLog(def))}
      />
    );
  };

  return (
    <View style={{ gap: 18 }}>
      <Txt weight={600} size={14} color={t.dim} style={{ marginHorizontal: 4 }}>
        {reached.size} of {MILESTONES.length} reached
      </Txt>

      {upcoming.length > 0 ? (
        <View>
          <SectionLabel text="Around now" />
          <View style={{ gap: 9 }}>{upcoming.map(renderRow)}</View>
        </View>
      ) : null}

      {groups.map((g) => (
        <View key={g.category}>
          <SectionLabel text={g.category} />
          <View style={{ gap: 9 }}>{g.items.map(renderRow)}</View>
        </View>
      ))}
    </View>
  );
}
```

- [ ] **Step 4: Add the segment to the Growth tab**

Replace `src/app/(tabs)/growth.tsx` with a version that keeps the metric grid as `MeasurementsView` and adds the segment. Full file:

```tsx
import { useState } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { isHovered } from '@/components/hover';
import { Txt } from '@/components/Txt';
import { MetricCard } from '@/features/measurements/MetricCard';
import { seriesFor } from '@/features/measurements/growthChart';
import { MilestonesView } from '@/features/milestones/MilestonesView';
import { hexA } from '@/lib/color';
import { MEAS_KINDS } from '@/lib/measurements';
import { DesktopPage } from '@/shell/DesktopPage';
import { useDesktopShell } from '@/shell/useDesktopShell';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

type Segment = 'measurements' | 'milestones';

function SegmentToggle({ value, onChange }: { value: Segment; onChange: (s: Segment) => void }) {
  const t = useTheme();
  const opts: { key: Segment; label: string }[] = [
    { key: 'measurements', label: 'Measurements' },
    { key: 'milestones', label: 'Milestones' },
  ];
  return (
    <View style={{ flexDirection: 'row', gap: 6, backgroundColor: t.chip, borderRadius: 14, padding: 4, marginBottom: 18 }}>
      {opts.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={(s) => [
              {
                flex: 1,
                height: 40,
                borderRadius: 11,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: active ? t.surface : 'transparent',
                borderWidth: 1.5,
                borderColor: active ? hexA(t.primary, 0.35) : 'transparent',
                cursor: 'pointer',
              },
              !active && isHovered(s) && { backgroundColor: t.dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' },
            ]}
          >
            <Txt unselectable weight={700} size={14} color={active ? t.text : t.dim}>
              {o.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

function MeasurementsView() {
  const measurements = useAppStore((s) => s.measurements);
  const openMeasurement = useAppStore((s) => s.openMeasurement);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 11 }}>
      {MEAS_KINDS.map((kind) => {
        const points = seriesFor(measurements, kind);
        return (
          <MetricCard
            key={kind}
            kind={kind}
            points={points}
            onPress={() =>
              points.length
                ? router.push({ pathname: '/metric/[kind]', params: { kind } })
                : openMeasurement(kind)
            }
          />
        );
      })}
    </View>
  );
}

export default function Growth() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const desktop = useDesktopShell();
  const child = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId));
  const openSwitcher = useAppStore((s) => s.openSwitcher);
  const [segment, setSegment] = useState<Segment>('measurements');

  const body = (
    <>
      <SegmentToggle value={segment} onChange={setSegment} />
      {segment === 'measurements' ? <MeasurementsView /> : <MilestonesView />}
    </>
  );

  if (desktop) return <DesktopPage maxWidth={640}>{body}</DesktopPage>;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: 24 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2, paddingTop: 4, paddingBottom: 16 }}>
        <Txt weight={800} size={27} tracking={-0.6}>
          Growth & Development
        </Txt>
        <Pressable
          onPress={openSwitcher}
          accessibilityRole="button"
          accessibilityLabel={child ? `${child.first}, switch child` : 'Switch child'}
          style={(s) => [{ cursor: 'pointer' }, isHovered(s) && { opacity: 0.85 }]}
        >
          <Avatar child={child} size={38} radius={12} fontSize={16} />
        </Pressable>
      </View>
      {body}
    </ScrollView>
  );
}
```

- [ ] **Step 5: Typecheck and verify the read-only view**

Run: `npx tsc --noEmit`
Expected: PASS.

Then run the app (`/run` or `npx expo start`) and confirm on phone width and desktop width:
- The Growth tab heading reads "Growth & Development" with a Measurements | Milestones toggle.
- Measurements shows the existing metric grid unchanged.
- Milestones shows "0 of 27 reached", no "Around now" if the child's age is outside every range (or a populated one if within), and the full grouped catalog with open circles and "typ. N-M mo".
- Tapping rows does nothing yet (handlers are stubbed).

- [ ] **Step 6: Commit**

```bash
git add "src/app/(tabs)/growth.tsx" src/features/milestones/MilestonesView.tsx src/features/milestones/MilestoneRow.tsx
git commit -m "feat(milestones): Growth & Development segment + read-only catalog"
```

---

### Task 6: Milestone log/edit/remove sheet

Wire tapping a row to a bottom sheet: log an unreached milestone (date + optional note), or edit/remove a reached one. Sheet state is local to `MilestonesView` (single entry point, so no store slot needed).

**Files:**
- Create: `src/features/milestones/MilestoneSheet.tsx`
- Modify: `src/features/milestones/MilestonesView.tsx` (replace the stub handlers, render the sheet)

**Interfaces:**
- Consumes: store `logMilestone`, `editMilestone`, `deleteEntry`; `BottomSheet`; `MilestoneDef`, `MilestoneEntry`.
- Produces: `<MilestoneSheet target={{ mode: 'log'; def } | { mode: 'edit'; entry }} onClose={() => void} />`.

- [ ] **Step 1: Build the sheet**

Create `src/features/milestones/MilestoneSheet.tsx`. This mirrors `MeasurementSheet`'s date stepper and note field, adapted to milestones:

```tsx
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/BottomSheet';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { fontFamily } from '@/theme/fonts';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';
import type { MilestoneDef } from '@/lib/milestones';
import type { MilestoneEntry } from '@/types/models';

const ONE_DAY = 86400000;
function midnight(offsetDays: number): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - offsetDays);
  return d.getTime();
}

export type MilestoneTarget = { mode: 'log'; def: MilestoneDef } | { mode: 'edit'; entry: MilestoneEntry };

export function MilestoneSheet({ target, onClose }: { target: MilestoneTarget; onClose: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const color = t.activity.note;
  const childFirst = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId)?.first);
  const logMilestone = useAppStore((s) => s.logMilestone);
  const editMilestone = useAppStore((s) => s.editMilestone);
  const deleteEntry = useAppStore((s) => s.deleteEntry);

  const title = target.mode === 'log' ? target.def.title : target.entry.text;
  const editing = target.mode === 'edit';

  const [dateMs, setDateMs] = useState(target.mode === 'edit' ? target.entry.time : midnight(0));
  const [note, setNote] = useState(target.mode === 'edit' ? (target.entry.note ?? '') : '');

  const today = midnight(0);
  const isToday = dateMs >= today;
  const dateLabel =
    dateMs >= today
      ? 'Today'
      : dateMs === midnight(1)
        ? 'Yesterday'
        : new Date(dateMs).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const stepDay = (delta: number) => setDateMs((d) => Math.min(today, d + delta * ONE_DAY));

  const onSave = () => {
    if (target.mode === 'log') logMilestone(target.def.key, dateMs, note.trim() || undefined);
    else editMilestone(target.entry.id, dateMs, note.trim() || undefined);
    onClose();
  };
  const onRemove = () => {
    if (target.mode === 'edit') deleteEntry(target.entry.id);
    onClose();
  };

  return (
    <BottomSheet onClose={onClose}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 14, flexShrink: 0 }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: hexA(color, t.dark ? 0.2 : 0.16), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="note" color={color} size={22} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt weight={800} size={20} tracking={-0.3}>
            {title}
          </Txt>
          {childFirst ? (
            <Txt weight={500} size={13} color={t.dim}>
              {editing ? 'reached' : 'mark reached'} for {childFirst}
            </Txt>
          ) : null}
        </View>
        <IconButton name="close" onPress={onClose} size={20} accessibilityLabel="Close" />
      </View>

      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
        <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 9 }}>
          Date reached
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <Pressable
            onPress={() => stepDay(-1)}
            accessibilityRole="button"
            accessibilityLabel="Previous day"
            style={(s) => [
              { width: 48, height: 48, borderRadius: 14, backgroundColor: t.chip, borderWidth: 1.5, borderColor: t.line, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
              isHovered(s) && { backgroundColor: t.elevated },
            ]}
          >
            <Icon name="chevron-left" color={t.text} size={22} />
          </Pressable>
          <View style={{ flex: 1, height: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, borderRadius: 14 }}>
            <Txt weight={700} size={15.5}>
              {dateLabel}
            </Txt>
          </View>
          <Pressable
            onPress={() => stepDay(1)}
            disabled={isToday}
            accessibilityRole="button"
            accessibilityLabel="Next day"
            accessibilityState={{ disabled: isToday }}
            style={(s) => [
              { width: 48, height: 48, borderRadius: 14, backgroundColor: t.chip, borderWidth: 1.5, borderColor: t.line, alignItems: 'center', justifyContent: 'center', opacity: isToday ? 0.4 : 1, cursor: isToday ? 'auto' : 'pointer' },
              !isToday && isHovered(s) && { backgroundColor: t.elevated },
            ]}
          >
            <Icon name="chevron-right" color={t.text} size={22} />
          </Pressable>
        </View>

        <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 9 }}>
          Note (optional)
        </Txt>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Add a memory..."
          placeholderTextColor={t.faint}
          style={{ minHeight: 48, borderRadius: 14, backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, paddingHorizontal: 14, fontSize: 14.5, fontFamily: fontFamily(500), color: t.text, marginBottom: 8 }}
        />
      </ScrollView>

      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 12, paddingBottom: insets.bottom + 8, borderTopWidth: 1, borderTopColor: t.line, flexShrink: 0 }}>
        {editing && (
          <Pressable
            onPress={onRemove}
            accessibilityRole="button"
            style={(s) => [
              { height: 58, paddingHorizontal: 20, borderRadius: 18, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
              isHovered(s) && { backgroundColor: t.elevated },
            ]}
          >
            <Txt unselectable weight={800} size={16} color="#E2725B">
              Remove
            </Txt>
          </Pressable>
        )}
        <Pressable
          onPress={onSave}
          accessibilityRole="button"
          style={(s) => [
            { flex: 1, height: 58, borderRadius: 18, backgroundColor: color, alignItems: 'center', justifyContent: 'center', boxShadow: `0px 8px 22px ${hexA(color, 0.35)}`, cursor: 'pointer' },
            isHovered(s) && { boxShadow: `0px 8px 22px ${hexA(color, 0.5)}` },
          ]}
        >
          <Txt unselectable weight={800} size={17.5} color={t.onActivity}>
            {editing ? 'Save changes' : 'Mark reached'}
          </Txt>
        </Pressable>
      </View>
    </BottomSheet>
  );
}
```

- [ ] **Step 2: Wire the sheet into MilestonesView**

In `src/features/milestones/MilestonesView.tsx`, replace the stub state/handlers from Task 5 with real ones and render the sheet. Change the import block to add the sheet, and replace the `useState`/`onLog`/`onEdit` lines:

```tsx
import { MilestoneSheet, type MilestoneTarget } from './MilestoneSheet';
```

```tsx
  const [target, setTarget] = useState<MilestoneTarget | null>(null);
  const onLog = (def: MilestoneDef) => setTarget({ mode: 'log', def });
  const onEdit = (entry: MilestoneEntry) => setTarget({ mode: 'edit', entry });
```

Then wrap the returned tree so the sheet renders as a sibling. Change the final `return (<View ...>...</View>)` to:

```tsx
  return (
    <>
      <View style={{ gap: 18 }}>
        {/* ...existing progress line, Around now, and groups... */}
      </View>
      {target ? <MilestoneSheet target={target} onClose={() => setTarget(null)} /> : null}
    </>
  );
```

Keep the existing children of the `<View style={{ gap: 18 }}>` exactly as they were.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Verify the full flow end to end**

Run the app and, connected to a Baby Buddy server, confirm:
- Tapping an unreached milestone opens the sheet; "Mark reached" with today's date checks the row and shows the reached date.
- On the Baby Buddy server, a new note appears for that child with body `🎉 <title>` and tags `milestone` + `mk:<key>`.
- Tapping the now-reached row reopens the sheet; changing the date and saving updates it; "Remove" deletes it (row returns to open) and shows the "Deleted" undo toast; Undo restores it.
- Add a note in the sheet; verify it lands on the second body line on the server and survives a refresh (re-read shows it in the sheet).
- The milestone never appears in the History tab or the Notes tab.
- Open a tag picker on any activity (e.g. a feed) and confirm `milestone` and `mk:*` tags are not listed.
- Repeat the toggle and a log on desktop width (sidebar shell) to confirm the sheet and catalog render there too.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS across the suite.

- [ ] **Step 6: Commit**

```bash
git add src/features/milestones/MilestoneSheet.tsx src/features/milestones/MilestonesView.tsx
git commit -m "feat(milestones): log/edit/remove sheet wired into the catalog"
```

---

## Self-Review Notes

- **Spec coverage:** tagged-note encoding + hidden tags (Task 1), three-way partition + repository (Task 2), catalog + age-aware helpers (Task 3), store log/edit + reused delete (Task 4), segmented Growth & Development nav + catalog + Around now (Task 5), log/edit/remove sheet + offline reuse (Task 6), tests throughout, non-goals respected (no custom milestones, no scoring, excluded from timeline/Notes).
- **`text` on read:** recovered from the note body first line, not the catalog, so Task 1 stays catalog-independent; the checklist rows always display the catalog title via `MILESTONE_BY_KEY[key]`/`def.title`, so a title change never breaks display.
- **Icon/token check** is an explicit step (Task 5 Step 2) because `check` and `t.activity.note` are assumed from sibling files; the step says what to do if a name differs.
