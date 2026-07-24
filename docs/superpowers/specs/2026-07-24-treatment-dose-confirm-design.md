# Confirm before logging a treatment dose

## Problem

Tapping a saved treatment (a "cure" internally) in the picker currently commits a
dose instantly at `now`, with no chance to adjust the time or catch a wrong
treatment before it lands (commit `9fec053`). A dose is often logged a while
after it was actually given, so the common case needs a quick time nudge, and
sometimes the amount or notes need a tweak too.

## Goal

Tapping a treatment opens a small confirm modal showing what will be logged,
letting the user adjust the time and either save straight away or open the full
form to edit more. No instant, unconfirmed write.

## Behavior

1. Tap a treatment in the picker. The picker closes and the medication sheet
   opens in a new **confirm mode**:
   - a read-only summary of the treatment (name plus dose, e.g. "Paracetamol ·
     2.5 mL"),
   - the time adjustment control (the existing `TimeEntry` "When" panel),
   - a save bar with two buttons: `Edit` on the left, `Save medication` on the
     right.
2. `Save medication` logs the dose at the chosen time and closes the sheet.
3. `Edit` expands the same sheet in place into the full editable medication form
   (name, amount, unit, notes, tags, all pre-filled from the treatment), and the
   `Edit` button disappears. The user then saves via the same `Save medication`
   button.
4. "Log manually" in the picker is unchanged: it opens the plain, empty form.

## Approach

The confirm modal is the existing `LogSheet` in medication mode, gated by a new
flag, rather than a separate component. This reuses `save()` as the single place
that builds the medication `Entry`, shows the offline-aware toast, and calls
`commitWrite`. "Edit" becomes an in-place expand of the same sheet, not a
sheet-to-sheet handoff.

### Changes

1. **`sheet` descriptor** (`src/store/useAppStore.ts`): the sheet state shape
   gains an optional `confirm?: boolean`. Only the treatment path sets it; every
   other `openSheet` / `openEdit` / `openTimerEdit` call leaves it unset.

2. **`logMedicationFromCure(cureId)`** (`src/store/useAppStore.ts`, currently near
   line 2588): revert from instant-commit back to seed-and-open, with the flag.
   - Look up the cure, gate on a non-empty trimmed name (same guard the old code
     kept, so a nameless record can never be seeded).
   - Seed the draft: `medName`, `medDosage`, `medUnit`, and for an interval cure
     (`scheduleMode === 'everyHours'` with `everyHours != null`)
     `medNextDoseIntervalSec = everyHours * 3600`. A times-of-day cure leaves the
     interval unset.
   - Open the medication sheet as a point draft (shape `point`, `agoMin: 0`) so
     `TimeEntry` renders the "When" panel, set `sheet: { type: 'medication',
     confirm: true }`, and clear `curePicker`.
   - No `Entry` is built or written here anymore; `commitWrite`, the toast, and
     the write queue move back behind `save()`.

3. **New action `expandMedicationLog()`** (`src/store/useAppStore.ts`): sets
   `sheet: { type: 'medication' }`, dropping `confirm` while leaving `te`,
   `editingId`, and `fromTimerId` untouched. Wired to the `Edit` button.

4. **`LogSheet.tsx`** — a `confirm` mode derived from `sheet.confirm && type ===
   'medication'`:
   - Replace the editable `MedicationField` with a read-only summary line: the
     name in bold plus a dim dose string built from the draft (`medDosage` +
     `medUnit`, joined the same way `cureDosageLabel` joins them). When there is
     no dosage, show the name alone.
   - Keep `<TimeEntry>`.
   - Hide the Notes section and the Tags section in confirm mode.
   - In the save bar, when in confirm mode render an `Edit` button in the left
     slot (the slot the `Delete` button uses when editing an existing entry;
     the two never coexist, since confirm mode is always a new entry). It calls
     `expandMedicationLog()`. `saveLabel` already resolves to "Save medication"
     for a new medication entry and is unchanged.

Nothing else changes: `loadTags()` still runs on open (harmless in confirm
mode), `save()` is untouched, and the offline toast and `commitWrite` path stay
exactly as they are.

## Data flow

```
picker tap
  -> logMedicationFromCure: seed te (name/dose/interval, point/agoMin:0),
     sheet = { type: 'medication', confirm: true }, curePicker = null
  -> LogSheet (confirm mode): summary + TimeEntry + [Edit] [Save medication]
       -> Save  -> save() builds + commits the dose at teEnd(te, now), closes
       -> Edit  -> expandMedicationLog(): sheet = { type: 'medication' }
                    -> LogSheet (full form) -> Save -> same save()
```

## Testing

Rework the three `logMedicationFromCure` cases in `src/store/useAppStore.test.ts`
from the current "instant log" assertions back to confirm-mode ones, and add one
for the expand transition:

1. `logMedicationFromCure` from an interval cure seeds `medName` / `medDosage` /
   `medUnit` / `medNextDoseIntervalSec` and opens the sheet in confirm mode
   (`sheet` equals `{ type: 'medication', confirm: true }`, `curePicker` is
   null). No entry is written.
2. From a times-of-day cure, the same seeding happens but `medNextDoseIntervalSec`
   stays undefined.
3. After `logMedicationFromCure` from an interval cure, calling `save()` writes a
   medication `Entry` carrying `nextDoseIntervalSec` (the dose still records the
   interval through the confirm path).
4. `expandMedicationLog()` clears `confirm` (`sheet` becomes `{ type:
   'medication' }`) while leaving the seeded `te` draft intact.

## Out of scope

- No change to "Log manually", to the treatment editor, or to the picker layout
  beyond what tapping a row triggers.
- No change to how doses sync to Baby Buddy's `/api/medication/`.
