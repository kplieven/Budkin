# Bath vocabulary and rhythm

**Date:** 2026-08-01
**Status:** Approved, ready for planning

## Problem

Budkin's bath feature carries two problems, one cosmetic and one structural.

**The vocabulary is household-private.** A bath is logged as a "small wash" or a
"big wash" (`src/types/timeEntry.ts:70`), phrasing that came from one family's
kitchen. The two-tier practice behind it is genuinely universal: full immersion
every few days, a partial wash of face, hands and bottom on the days between.
Every language has a name for the pair (NHS "topping and tailing" against a
bath, French *toilette* against *bain*, Dutch *wasbeurt* against *in bad*). None
of them is "small wash". A stranger opening the log sheet sees a field named
"Wash" offering "Small" and "Big" with nothing to say what is being sized.

**The rhythm model cannot survive the child growing up.** `nextWashKind`
(`src/store/selectors.ts:321`) counts backwards: if the last N baths were all
small, a big one is due. That encodes the 0-to-6-month pattern and nothing else.

- It has **no time axis at all**. Skip bathing for ten days and nothing ever
  comes due, because the rule only inspects the last N records.
- It hardcodes the direction of the relationship: quick washes are frequent,
  full baths are rare. Around 6 months that **inverts**. Solids mean a dirty
  face after every meal and crawling means dirty knees, so full baths climb
  toward daily while partial washes stop being scheduled at all and become
  reactive. By toddlerhood the bath is a nightly ritual and the partial wash has
  dissolved into hand washing that nobody logs.
- The rhythm is a single global pref (`smallWashesPerBig`,
  `src/data/prefs.ts:62`). A 4-month-old and a 3-year-old sit at opposite ends
  of that progression, so one number cannot serve two children.

## Goal

Replace the private vocabulary with wording that reads correctly to someone who
has never met this household, on screen and on the Baby Buddy server, and
replace the count-based rhythm with a per-child, time-based one whose numbers
can walk from newborn to school age without a rewrite.

## Decisions (from brainstorming)

1. **Wording: "Quick wash" and "Full bath."** Self-explanatory in any English
   variant. The asymmetry is truthful: a full bath happens in the tub, a quick
   wash happens at the changing table.
2. **The rename reaches the wire, with a manual server migration.** Structural
   tags move to a `bath:` prefix and a script re-tags the existing records. The
   user runs it by hand against their single server.
3. **Rhythm: one interval in days per wash type, either can be off.** Uniform
   and symmetric, so neither type is privileged.
4. **Any bath resets the quick-wash clock; only a full bath resets the
   full-bath clock.** A full bath is a quick wash and more, so it satisfies the
   lesser obligation. This one asymmetry is what makes the model survive growth
   without special cases.
5. **Rhythm is per child**, stored outside `prefs.ts`.
6. **No age-based auto-adjustment.** Changing someone's bath schedule on the
   app's own initiative is advice-giving, the category `napSuggestions` already
   keeps opt-in and labels as not medical consensus.
7. **No i18n.** The vocabulary is English-only, as the rest of the app is.

## Vocabulary

| Surface | Now | After |
| --- | --- | --- |
| Log sheet field label (`LogSheet.tsx:737`) | `Wash` | `Bath type` |
| Log sheet options (`LogSheet.tsx:753`) | Small wash / Big wash | **Quick wash** / **Full bath** |
| History detail (`detail.ts:112`) | Small wash / Big wash | Quick wash / Full bath |
| Home tile (`DashboardContent.tsx:140`) | "Small wash due" / "Big wash due today" | "Quick wash due" / "Full bath due today" |
| Home tile, done | "Washed today" | unchanged, it already covers both |
| Settings (`settings/index.tsx:384`) | "Big wash / After every 3 small washes" | see Settings below |

`ACTIVITY_LABEL.bath` stays `Bath` (`src/lib/activities.ts:80`). The activity is
still a bath; only the two kinds are renamed.

## Internal representation

`wash?: 'small' | 'big'` becomes `wash?: 'quick' | 'full'` throughout.

A single normalizer handles every value that predates the rename:

```
normalizeWash(raw): 'quick' | 'full'
  'big' | 'full' -> 'full'
  anything else  -> 'quick'
```

The fallthrough preserves today's rule, where anything that is not explicitly
big reads as small.

It must be applied at **both** read boundaries:

1. **Local hydration.** Entries persist as raw JSON in AsyncStorage chunks
   (`budkin.entries.v2.<YYYY-MM>`, `src/data/entityStore.ts:54`), so every bath
   already on the device stores the literal string `'small'`.
2. **Server read**, in `noteToBathEntry` (`src/api/client.ts:306`).

**This is the trap in the whole change.** The rhythm predicate tests
`b.wash === 'small'` (`src/store/selectors.ts:327`). Rename the union without
normalizing on local hydration and that comparison is permanently false against
existing data, so a full bath never comes due again. The failure is silent and
looks like the feature quietly stopping rather than like a bug.

## Wire format

The marker tag `bath` is unchanged. It is specific enough not to squat on
anything, and it is what `isBathNote` (`src/api/client.ts:290`) keys on.

Size tags move to the prefix convention already used by `intake:` and `mk:`:

| Meaning | Now | After |
| --- | --- | --- |
| Full bath | tag `big` | tag `bath:full` |
| Quick wash | tag `small` | tag `bath:quick` |
| Note body | `Bath, big wash` / `Bath, small wash` | `Full bath` / `Quick wash` |

- **Read:** `bath:full` means full; else legacy `big` means full; else quick.
- **Write:** always the new names.
- **Body** is cosmetic on read and always has been, since `noteToBathEntry`
  derives the size from tags alone. The new body is self-contained so it reads
  properly in Baby Buddy's own note list, where `Bath, small wash` currently
  leaks this household's vocabulary to anything else looking at the server.

`BATH_STRUCTURAL_TAGS` (`src/api/client.ts:185`) grows to
`['bath', 'bath:quick', 'bath:full', 'small', 'big']`, and `HIDDEN_TAGS`
inherits it as it does today.

Keeping `small` and `big` in that list after the migration is deliberate. It
means the bare words stay reserved and hidden from the tag picker. Freeing them
would be the purist move, since the collision hazard documented for `intake:`
applies doubly to two ordinary English words, but then a user tag literally
named `big` on a bath note would read back as a legacy full bath. Reserving two
words costs nothing; a silently wrong wash size costs trust.

**The legacy read path stays in the app**, unlike the `cure` to `treatment`
rename which shipped none. Bath entries are far higher volume and a misread here
is silent rather than loud, and it self-heals: a legacy note rewrites to the new
tags on its next edit.

## Rhythm model

Each wash type gets its own interval in whole days. `0` means off.

```
washDueState(entries, rhythm, now) -> { full, quick, nextKind }

  full  = fullEveryDays  > 0 && calendarDaysSince(last FULL bath) >= fullEveryDays
  quick = quickEveryDays > 0 && calendarDaysSince(last ANY  bath) >= quickEveryDays
  nextKind = full ? 'full' : 'quick'
```

- **Never bathed** means due.
- **Distance is in local calendar days**, computed with the existing
  `startOfDay` (`src/store/selectors.ts:480`), not in 24-hour blocks. The
  schedule is a bedtime routine, so a Monday evening bath should read as two
  days by Wednesday morning.
- **`nextKind` drives the log sheet pre-selection** (`useAppStore.ts:2735`). It
  falls back to `'quick'` even when the quick interval is off, because off means
  "do not remind me", never "cannot be logged".
- Derived from history on every call, never from a stored counter, preserving
  the property the current `nextWashKind` comment already argues for: changing
  an interval re-reads the existing baths immediately.

### Why the reset asymmetry matters

Because any bath resets the quick clock while only a full bath resets the full
clock, the same two numbers describe every stage:

| Phase | Full | Quick | What surfaces |
| --- | --- | --- | --- |
| Cord stump still on | off | 1 | Quick wash, daily |
| 0 to 6 months | 3 | 1 | Full bath every 3rd day, quick wash between |
| 6 to 12 months | 2 | 1 | Full bath every other day |
| Toddler | 1 | 1 | Full bath daily, quick wash never surfaces alone |
| School age | 2 | off | Full bath only |

Note the toddler row. Once the full interval reaches 1, every bath resets the
quick clock, so the quick wash stops appearing without the user disabling
anything. The phase inversion described in Problem handles itself.

### `0` reverses a documented invariant

`clampSmallWashesPerBig` (`src/store/selectors.ts:304`) currently forbids 0 with
a specific argument: an empty lookback window makes `every()` vacuously true, so
a big wash would latch as due forever. That reasoning dies with the count model.
In the new one, 0 is caught before any date arithmetic and returns not-due. The
new clamp accepts 0 to 30, and carries an explicit comment recording this
reversal so nobody restores the old floor on the strength of the old comment.

### Home tile states

Evaluated in order, per child:

1. A bath logged today (`bathGivenToday`, unchanged) gives "Washed today" and
   the done check.
2. Full due gives "Full bath due today".
3. Quick due gives "Quick wash due".
4. Otherwise the sooner of whichever intervals are on: "Quick wash tomorrow",
   "Full bath in 2 days". This mirrors the forward-looking hint the Medication
   tile already models on the bath tile (`src/store/selectors.ts:657`).
5. Both intervals off gives no hint.

## Rhythm storage

New module `src/data/bathRhythm.ts`, mirroring `src/data/milestonePrompts.ts`
in shape and error handling:

- Key `budkin.bathRhythm.v1`
- Shape `Record<childId, { fullEveryDays: number; quickEveryDays: number }>`

`smallWashesPerBig` is removed from `Prefs` entirely, so `prefs.ts` keeps its
"every pref is global" invariant rather than growing an exception.

Keying by child id is only safe because child ids stopped mutating on push. On
the old model this map would have been orphaned the first time a child synced.

**Legacy fallback is stateless, not a seeding pass.** A child with no stored
entry falls back to a default derived from the legacy `prefs.smallWashesPerBig`
if that value is still in storage:

```
fullEveryDays  = smallWashesPerBig + 1
quickEveryDays = 1
```

else to the built-in `{ fullEveryDays: 3, quickEveryDays: 1 }`. No write and no
ordering dependency between prefs and children loading, and it is idempotent.
The first edit to a child writes a real entry, after which the legacy value is
irrelevant for them.

The two defaults differ on purpose. 3 matches the mainstream 2-to-3-full-baths-
a-week guidance for a new install; `legacy + 1` preserves the cadence an
existing user already feels, since 3 quick washes between full baths means a
full bath every 4th bath, which on daily bathing is every 4 days.

## Settings

Stays in the existing `Rhythm` section (`src/app/settings/index.tsx:377`), no
new route. One block per child, each headed by the child's name, containing two
`CountField` steppers:

```
Bath rhythm for Mila
  Full bath   every [ 3 ] days
  Quick wash  every [ 1 ] days
  Type a number or use - and +, 0 to 30. 0 turns that reminder off.
  The rhythm is read off the baths already logged, so a change shows up
  straight away in what's due next.
```

The name is always shown, including with a single child, so the layout does not
branch and the per-child nature is obvious.

## Server migration script

`scripts/migrate-bath-tags.mjs`, modeled on
`scripts/migrate-cure-tags-to-treatment.mjs`: dry run by default, `--apply`,
`--url` and `--token` with `BABYBUDDY_URL` / `BABYBUDDY_TOKEN` fallbacks,
`--page-size`, `ordering=id` pagination with the reported-count check, all
records collected before any write, pure exported mapping helpers, idempotent.

Two deliberate departures from that script:

**Scoping.** The `cure` rename was a safe prefix rewrite because nothing but
Budkin ever wrote a `cure*` tag. Here `small` and `big` are ordinary words that
may legitimately tag anything. The script therefore fetches `?tags=bath` and
rewrites size tags **only on notes carrying the `bath` tag**, re-checking
locally rather than trusting the server filter. A `small` tag anywhere else is
never touched. Note bodies are rewritten only when they exactly match a body
Budkin generated (`Bath, small wash`, `Bath, big wash`); anything hand-edited in
Baby Buddy is left byte-identical.

**No `--delete-old-tags`.** In Baby Buddy a tag can attach to feedings, changes,
sleeps and more, so proving `small` is unused would mean sweeping every model.
Deleting a tag the user applies elsewhere is not a risk worth taking for
tidiness. The script prints a closing note pointing at Baby Buddy's own tag
admin, where usage is visible.

Safe run order, as documented in the cure script's header: drain every device's
offline queue on the current build first, dry run, apply, then install the
updated app.

## Testing

Vitest currently includes only `src/**/*.test.ts` and the cure script has no
test at all. Widen the include by one glob for `scripts/**/*.test.mjs`.

**`src`:**

- `normalizeWash` legacy mapping, both directions and the unknown-value
  fallthrough.
- `washDueState` fed entries carrying legacy `'small'` values, proving the trap
  described under Internal representation is closed.
- The reset asymmetry: a full bath satisfies a due quick wash; a quick wash does
  not satisfy a due full bath.
- `0` as off on each axis independently, including both off.
- Never bathed reads as due.
- Calendar-day boundaries rather than 24-hour ones, including an evening bath
  read the following morning.
- Serializer round trip: new tags out, legacy tags in, user tags preserved.
- Legacy rhythm fallback producing `legacy + 1`, and the built-in default when
  no legacy value exists.

**`scripts`:** the pure mapping helpers, above all the scoping rule that a note
without a `bath` tag is returned unchanged even when it carries `small`.

## Out of scope

Left open deliberately, all surfaced during research:

- **Hair washing** as a third axis on its own cadence, which is how most
  families run it from school age. The per-type interval model extends to a
  third pair of numbers without rework.
- **Free-text notes on baths.** Bath is still the only activity that cannot
  carry one, because the note body is structural (`LogSheet.tsx:885`).
- **i18n**, and with it the established localized vocabulary.
- **Bath duration.** Baths stay point events, which matches every other tracker.
