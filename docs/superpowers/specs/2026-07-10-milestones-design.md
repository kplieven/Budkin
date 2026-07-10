# Milestones: predefined developmental milestone checklist

**Date:** 2026-07-10
**Status:** Approved, ready for planning

## Problem

Parents want to track developmental milestones like "first steps", "first word",
and "first laugh", but the app has no first-class place for them. The only option
today is a free-text general note, which forces the parent to remember and type
each milestone. It gives no sense of what's typical or what's coming up, and there
is no browsable catalog or progress overview.

Baby Buddy has no milestones resource. Its only native `milestone` field is a
free-text annotation on **Tummy Time** entries, which is unrelated to a general
milestone log. The community-idiomatic way to record milestones on Baby Buddy is
a **tagged Note**, which is exactly how this app already models baths.

## Goal

Add a **predefined milestone catalog** the parent can browse and log against, as
an **achievement checklist**:

- Browse a curated catalog of 27 milestones grouped into categories, each with a
  gentle **typical age range**.
- Milestones the baby has reached show as checked, with the reached date. The
  rest show as open, with their typical range.
- An **"Around now"** section surfaces not-yet-reached milestones whose typical
  range spans the baby's current age, so what's relevant floats to the top.
- Logging a milestone records a dated, tagged Note on Baby Buddy. "Reached" state
  is **derived** from whether that record exists, so there is nothing separate to
  store or sync.

The catalog includes the parent's three examples (first steps, first word, first
laugh).

## Non-goals (v1)

- **No custom or user-authored milestones.** The catalog is fixed. Free-text
  general notes already cover anything bespoke, and custom milestones are a
  straightforward later add.
- **No "on track / behind / overdue" scoring.** Age ranges are informational
  only, and the UI never uses "behind" or "overdue" language. Normal development
  varies enormously and the app will not imply otherwise.
- **Milestones do not appear in the History timeline.** They surface only in the
  catalog, matching the existing decision that general notes stay out of the
  timeline. This can be revisited later.
- **No re-logging a reached milestone.** The checklist is one record per key.
  Editing or removing an existing record is supported; logging a second record
  for the same key is not.
- **No photos on milestones.** A later add; general notes and child photos
  already exist.

## Decisions (resolved during brainstorming)

### Interaction model: achievement checklist, not repeatable quick-log
Milestones are one-time events, the way parents think of them. The catalog tracks
done versus not-yet, and "reached" state is derived from the presence of a
milestone note, so there is nothing extra to persist and it stays offline-first.

### Age awareness: gentle age-aware, not flat and not anxiety-inducing
Each milestone carries a typical age range. The catalog softly surfaces an
"Around now" section for the baby's current age and shows ranges inline, but never
compares judgmentally ("behind" and "overdue" are banned).

### Navigation: fold into the Growth tab as a segmented view
The **Growth** tab becomes **"Growth & Development"** with a top segmented control
labelled **Measurements | Milestones**. This avoids a 7th mobile tab (the tab bar
already has six) and pairs physical growth with developmental growth. The tab-bar
and sidebar entry keep the existing `growth` route, `chart` icon, and short
"Growth" label. Only the on-screen heading gains "& Development". Segment
selection is local screen state, defaulting to **Measurements** so the existing
Growth experience is unchanged on open.

### Baby Buddy mapping: tagged notes, mirroring baths
Milestones ride on `/api/notes/`, exactly like baths, which reuses the existing
note read, write, partition, and offline-sync machinery.

## Baby Buddy encoding

### Tags
Each milestone note carries **two structural tags**:

- `milestone`: the marker tag and the read-time partition discriminator (parallel
  to the `bath` tag). It also lets other Baby Buddy clients filter for all
  milestones at once.
- `mk:<key>`: identifies which milestone, for example `mk:first-steps`. The `mk:`
  namespace prevents collisions with user tags and makes hiding a simple prefix
  test. Matching is by this stable key, so display titles can change (or be
  localized) without breaking reached-state.

User tags on a milestone note round-trip untouched, the same guarantee baths give.
Both structural forms are hidden from the tag picker: the hidden-tag check adds
`milestone` and the `mk:` prefix, so neither the marker nor any key tag ever
appears as a selectable or creatable chip.

### Note body
The Baby Buddy `note` field reads sensibly for other clients. It is the emoji plus
the title on the first line, and if the parent adds a note it goes on the next
line:

```
🎉 First steps
She let go of the couch and took three!
```

The body is a snapshot for humans. On read, the parent note is recovered as
everything after the first line. The app never relies on the body for
classification or for the title: `mk:<key>` is the source of truth for both.

### Round-trip helpers (in `src/api/client.ts`, beside the bath helpers)
- `isMilestoneNote(n): boolean`, returning `tagNames(n.tags).includes('milestone')`.
  This is the single shared discriminator, used by every partition path so
  classification can never diverge.
- `noteToMilestoneEntry(n, childId): MilestoneEntry`: parse `mk:<key>` out of the
  tags for `key`; `time` from `n.time`; `text` from the catalog title for `key`
  (falling back to the first body line with the emoji stripped if the key is
  unknown, for forward-compat if the catalog shrinks); optional parent `note`
  recovered from the body's later lines; non-structural tags kept as `tags`.
- `milestoneToNoteBody(entry): Record<string, unknown>`: `child`, `time`, `note`
  (the two-line body above), and `tags: ['milestone', 'mk:'+key, ...userTags]`.

`MILESTONE_STRUCTURAL` is the `milestone` marker; key tags are matched by the
`mk:` prefix. `noteToNoteBody` (general notes) and `bathToNoteBody` already strip
their own structural tags, and they additionally strip the milestone structural
tags so a note can never be misclassified across types.

## Data model (`src/types/models.ts`)

New entry type, mirroring how `BathEntry` is a distinct type rather than a flavor
of `NoteEntry`:

```ts
export interface MilestoneEntry extends EntryBase {
  type: 'milestone';
  /** stable catalog key, e.g. 'first-steps' (from the mk:<key> tag) */
  key: string;
  /** the reached date (point event; EntryBase carries no time of its own,
   *  each point type declares it, like BathEntry/DiaperEntry) */
  time: number;
  /** display title snapshot (from the catalog, or recovered on read) */
  text: string;
  /** optional free-text note the parent added */
  note?: string;
}
```

- Added to the `Entry` union.
- **Not** added to `POINT_ACTIVITIES` or the timeline detail set, so milestones
  are excluded from History like general notes.
- `entryTimestamp` already resolves a point entry's `time`. `MilestoneEntry.time`
  is the reached date, so grouping and sorting reuse works unchanged.

## The catalog (`src/lib/milestones.ts`, pure data plus helpers)

A static, ordered catalog. Each entry:

```ts
interface MilestoneDef {
  key: string;        // stable, kebab-case; the mk:<key> tag
  title: string;      // display title
  category: MilestoneCategory;
  minMonths: number;  // typical range start (inclusive)
  maxMonths: number;  // typical range end   (inclusive)
}
```

Categories, in display order: **Movement**, **Hands & play**, **Communication**,
**Social & emotional**, **Feeding & firsts**.

| key | title | category | typ. months |
| --- | --- | --- | --- |
| lifts-head | Lifts head | Movement | 1-3 |
| rolls-over | Rolls over | Movement | 4-6 |
| sits-unassisted | Sits unassisted | Movement | 5-8 |
| crawls | Crawls | Movement | 7-10 |
| pulls-to-stand | Pulls to stand | Movement | 8-11 |
| cruises | Cruises furniture | Movement | 9-12 |
| stands-alone | Stands alone | Movement | 10-14 |
| first-steps | First steps | Movement | 9-15 |
| grasps-toy | Grasps a toy | Hands & play | 3-5 |
| passes-toy | Passes toy hand to hand | Hands & play | 5-7 |
| pincer-grasp | Pincer grasp | Hands & play | 8-12 |
| stacks-blocks | Stacks blocks | Hands & play | 12-18 |
| coos | Coos | Communication | 2-4 |
| first-laugh | First laugh | Communication | 3-5 |
| babbles | Babbles | Communication | 4-7 |
| responds-to-name | Responds to name | Communication | 6-9 |
| waves-bye | Waves bye-bye | Communication | 9-12 |
| first-word | First word | Communication | 9-14 |
| points | Points at things | Communication | 9-14 |
| first-smile | First smile | Social & emotional | 1-3 |
| peekaboo | Enjoys peekaboo | Social & emotional | 5-9 |
| stranger-awareness | Stranger awareness | Social & emotional | 6-10 |
| shows-affection | Shows affection | Social & emotional | 9-15 |
| first-solid | First solid food | Feeding & firsts | 4-6 |
| first-tooth | First tooth | Feeding & firsts | 4-10 |
| finger-feeds | Finger-feeds self | Feeding & firsts | 8-12 |
| drinks-from-cup | Drinks from a cup | Feeding & firsts | 9-15 |

Pure helpers, all unit-tested:

- `MILESTONES: MilestoneDef[]` and `MILESTONE_BY_KEY: Record<string, MilestoneDef>`.
- `catalogTitle(key): string | undefined`, a title lookup for the read path.
- `reachedByKey(entries): Map<string, MilestoneEntry>` to derive reached-state. If
  duplicates for a key somehow exist, the **earliest** `time` wins.
- `aroundNow(ageMonths, reachedKeys): MilestoneDef[]`, the not-yet-reached defs
  whose `[minMonths, maxMonths]` contains `ageMonths` (empty when age is unknown).
- `groupByCategory(defs): { category, items }[]`, with stable category ordering.

Age in months derives from the selected child's `birth` and `now`. Use a helper
akin to the existing `ageStr` logic in `src/lib/format.ts`: reuse a month-count
helper if one already exists there, otherwise add one.

## UI

### `src/app/(tabs)/growth.tsx`: host the segment
- Heading becomes **"Growth & Development"**.
- A segmented control (**Measurements | Milestones**) under the heading, using the
  existing `Chip` or segment styling already in the app. Match the Insights or
  History segmented patterns rather than inventing a new control.
- `Measurements` renders today's existing metric-card grid unchanged.
- `Milestones` renders `<MilestonesView />`.
- Both phone (`ScrollView`) and desktop (`DesktopPage`) keep their current
  wrappers, with the segment inside both.

### `src/features/milestones/MilestonesView.tsx`: the catalog
Top to bottom:

1. **Progress line**, for example "8 of 27 reached".
2. **Around now** (omitted when empty or when age is unknown): the not-yet-reached
   milestones for the baby's current age, each row showing the typical range.
3. **All milestones**, grouped by category with the same uppercase section-label
   styling the Notes and History screens use. Each `MilestoneRow`:
   - **Reached**: check state, title, and reached date (matching the note-row date
     style). Tap opens the edit sheet.
   - **Not reached**: open circle, title, and "typ. N-M mo". Tap opens the log
     sheet.

Empty and edge states:
- **No child selected**: the whole Milestones view shows a gentle empty prompt,
  since there is no age context to work from.
- **Age unknown or out of every range**: "Around now" is simply omitted, and the
  full catalog still renders.

### `src/features/milestones/MilestoneSheet.tsx`: log and edit
A `BottomSheet` reusing the shared component and the existing date and note-input
building blocks from the log and measurement sheets:

- **Logging** (from an unreached row): a **date** field defaulting to today, an
  optional **note**, and a primary **"Mark reached"** action.
- **Editing** (from a reached row): pre-filled date and note with a **Save**
  action, plus a destructive **Remove** that deletes the record through the
  existing delete-and-undo-toast path.

## Store and sync (`src/store/useAppStore.ts`)

Reuses the offline write queue and `pendingOps` update/delete paths end to end.
Milestones are just another entry type flowing through the same machinery baths
and notes use.

New actions, each a thin wrapper over an existing create, update, or delete entry
path:

- `logMilestone(key, date, note?)`: build a `MilestoneEntry`, prepend it to
  `entries`, and enqueue a create (`POST /api/notes/` via `milestoneToNoteBody`).
- `editMilestone(id, { date, note })`: update in place plus a durable update op.
- `removeMilestone(id)`: optimistic remove plus a durable delete op and an undo
  toast, matching how notes and baths delete.

Sheet open and close mirror the existing `openSheet` and `openEdit` state slots.
Either reuse a small local screen state in `MilestonesView` or add
`openMilestone(key)` and `openEditMilestone(id)` slots. Decide during planning to
match whichever pattern the log and measurement sheets already follow most
closely.

### Read path (`src/api/client.ts` and `src/data/repository.ts`)
`listChildNotes` now partitions the single `/api/notes/` fetch **three** ways:

```ts
for (const n of data.results) {
  if (isMilestoneNote(n)) milestones.push(noteToMilestoneEntry(n, childId));
  else if (isBathNote(n)) baths.push(noteToBathEntry(n, childId));
  else notes.push(noteToNoteEntry(n, childId));
}
return { baths, milestones, notes };
```

`repository.ts` spreads `notesData.milestones` into `entries` alongside `baths`
and `notes`. Check `milestone` **first**: a note could in theory carry both tags,
and the milestone marker wins. There is no new network request, since the notes
fetch already returns them.

## Testing

Pure-function unit tests (Vitest, matching the repo's existing `.test.ts` style):

- **`src/lib/milestones.test.ts`**
  - `reachedByKey` maps keys to entries, and the earliest `time` wins on
    duplicates.
  - `aroundNow` includes only not-yet-reached defs whose range contains the age,
    with boundary inclusivity at both min and max, and returns empty when age is
    undefined.
  - `groupByCategory` preserves category order and omits empty categories.
- **`src/api/client.test.ts`** (extend)
  - `isMilestoneNote` is true only with the `milestone` tag.
  - `milestoneToNoteBody` then `noteToMilestoneEntry` round-trips `key`, `time`,
    and `note`, and preserves user tags while dropping structural tags.
  - Three-way partition: a milestone-tagged note is not returned as a bath or a
    general note (and vice versa), and a note carrying both `milestone` and `bath`
    classifies as a milestone.
  - `noteToNoteBody` and `bathToNoteBody` strip milestone structural tags.
- **Manual and `/verify`**: the segment toggles on phone and desktop; logging a
  milestone checks it with a date and the note appears on the Baby Buddy server
  with `milestone` and `mk:<key>` tags; edit changes the date; remove deletes it
  with undo; "Around now" reflects the child's age; the milestone never shows in
  History or the Notes list; the `mk:` tags never appear in the tag picker.

## Scope and decomposition

This is one cohesive feature along a single data path: catalog data, tagged-note
encoding, three-way partition, checklist UI, offline sync. It ships as a single
spec and plan. Natural build order for the plan:

1. Catalog data, helpers, and tests.
2. Baby Buddy encoding, three-way partition, and tests.
3. Store actions.
4. UI: segment, catalog, and sheet.
