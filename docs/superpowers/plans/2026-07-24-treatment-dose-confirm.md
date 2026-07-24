# Confirm-before-log treatment dose Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tapping a saved treatment opens a confirm modal (read-only summary + time picker, with `Edit` and `Save medication`) instead of instantly logging the dose.

**Architecture:** The confirm modal reuses the existing `LogSheet` in medication mode, gated by a new `sheet.confirm` flag, so `save()` stays the single write path. `logMedicationFromCure` reverts from instant-commit to seed-and-open; a new `expandMedicationLog()` action powers the `Edit` button's in-place expand into the full form.

**Tech Stack:** TypeScript, React Native (Expo), zustand v5 store, vitest.

## Global Constraints

- No em-dashes anywhere (prose, comments, UI copy). Use commas, colons, or separate sentences.
- zustand v5: never return a fresh array/object from a `useAppStore` selector. Select raw values and derive in render.
- Read the versioned Expo docs (https://docs.expo.dev/versions/v56.0.0/) before writing any Expo API code.
- Tests run with `npm test` (vitest). There is no typecheck script; use `npx tsc --noEmit`.

---

### Task 1: Store — confirm flag, seed-and-open action, expand action

**Files:**
- Modify: `src/store/useAppStore.ts` (sheet state type `:171`; action docstrings `~:328`; `logMedicationFromCure` impl `~:2588`)
- Test: `src/store/useAppStore.test.ts` (the three `logMedicationFromCure` cases at `~:924-962`)

**Interfaces:**
- Produces:
  - `sheet: { type: ActivityType; confirm?: boolean } | null` (adds optional `confirm`)
  - `logMedicationFromCure(cureId: string): void` — now seeds the medication draft from the cure and opens `sheet: { type: 'medication', confirm: true }`, clearing `curePicker`. Writes no entry.
  - `expandMedicationLog(): void` — sets `sheet: { type: 'medication' }` (drops `confirm`), leaving `te` / `editingId` / `fromTimerId` untouched.

- [ ] **Step 1: Rewrite the failing tests**

In `src/store/useAppStore.test.ts`, replace the three existing `it(...)` blocks (from `'logMedicationFromCure instantly logs a dose from an interval cure (no form to confirm)'` through `'logMedicationFromCure logs the dose directly without seeding the manual draft'`, currently `~:924-962`) with these four:

```ts
  it('logMedicationFromCure from an interval cure seeds the draft and opens the confirm sheet (nothing committed yet)', () => {
    useAppStore.setState({ cures: [cure()], curePicker: { open: true } });
    s().logMedicationFromCure('cure-1');
    // Opens the medication sheet in confirm mode and closes the picker.
    expect(s().sheet).toEqual({ type: 'medication', confirm: true });
    expect(s().curePicker).toBeNull();
    // A point (time-only) draft, seeded from the cure. Nothing is written until save().
    expect(s().te.shape).toBe('point');
    expect(s().te.medName).toBe('Paracetamol');
    expect(s().te.medDosage).toBe(2.5);
    expect(s().te.medUnit).toBe('mL');
    expect(s().te.medNextDoseIntervalSec).toBe(6 * 3600); // everyHours * 3600
    expect(s().entries).toEqual([]);
  });

  it('logMedicationFromCure from a times-of-day cure seeds no next-dose interval', () => {
    useAppStore.setState({
      cures: [cure({ scheduleMode: 'timesOfDay', timesOfDay: ['morning', 'evening'], everyHours: undefined })],
    });
    s().logMedicationFromCure('cure-1');
    expect(s().te.medName).toBe('Paracetamol');
    expect(s().te.medNextDoseIntervalSec).toBeUndefined();
  });

  it('saving from the confirm sheet writes a dose carrying nextDoseIntervalSec', () => {
    useAppStore.setState({ cures: [cure({ everyHours: 8 })] });
    s().logMedicationFromCure('cure-1');
    s().save();
    const e = s().entries[0] as Extract<Entry, { type: 'medication' }>;
    expect(e.type).toBe('medication');
    expect(e.childId).toBe('c1');
    expect(e.time).toBe(NOW); // point draft, agoMin 0
    expect(e.name).toBe('Paracetamol');
    expect(e.dosage).toBe(2.5);
    expect(e.dosageUnit).toBe('mL');
    expect(e.nextDoseIntervalSec).toBe(8 * 3600);
  });

  it('expandMedicationLog drops the confirm flag but keeps the seeded draft', () => {
    useAppStore.setState({ cures: [cure()], curePicker: { open: true } });
    s().logMedicationFromCure('cure-1');
    const seeded = s().te;
    s().expandMedicationLog();
    expect(s().sheet).toEqual({ type: 'medication' });
    expect(s().te).toBe(seeded); // same draft reference, untouched
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/store/useAppStore.test.ts -t "logMedicationFromCure|confirm sheet|expandMedicationLog"`
Expected: FAIL. The first case fails on `sheet` (currently `null` after an instant log); `expandMedicationLog` fails as "not a function".

- [ ] **Step 3: Extend the `sheet` state type**

In `src/store/useAppStore.ts`, at the `sheet:` field of the state interface (`:171`):

```ts
  sheet: { type: ActivityType; confirm?: boolean } | null;
```

- [ ] **Step 4: Update the action docstrings and declare `expandMedicationLog`**

In the `AppActions` interface (`~:328`), replace the `logMedicationFromCure` doc comment and add the new declaration right after it:

```ts
  /** Tapping a saved cure: seed the medication draft from it (name/dosage/unit,
   *  plus the next-dose interval for an interval cure) and open the medication
   *  sheet in confirm mode (a read-only summary + the time picker), closing the
   *  picker. No dose is written here; save() commits it once the user confirms. */
  logMedicationFromCure: (cureId: string) => void;
  /** Reveal the full editable medication form from the confirm modal: drop the
   *  `confirm` flag on the medication sheet, keeping the seeded draft. */
  expandMedicationLog: () => void;
```

- [ ] **Step 5: Rewrite `logMedicationFromCure` and add `expandMedicationLog`**

In `src/store/useAppStore.ts`, replace the whole current `logMedicationFromCure` implementation (`~:2588-2618`, the instant-log version) with:

```ts
  logMedicationFromCure: (cureId) => {
    const cure = get().cures.find((c) => c.id === cureId);
    if (!cure) return;
    // A cure always carries a name (the editor requires one), but gate on it the
    // same way save() gates a manual dose so a nameless record can never be seeded.
    if (!cure.name.trim()) return;
    // Confirm-before-log: seed a fresh point medication draft from the cure and
    // open the sheet in confirm mode (read-only summary + time picker). No entry
    // is written here; save() commits it once the user confirms. openSheet resets
    // the draft to a blank point medication form, so seed it afterwards.
    get().openSheet('medication');
    const patch: Partial<TimeEntryState> = {
      medName: cure.name,
      medDosage: cure.dosage,
      medUnit: cure.dosageUnit,
      // Only an interval cure carries a next-dose interval onto the dose; a
      // times-of-day cure leaves it unset.
      medNextDoseIntervalSec:
        cure.scheduleMode === 'everyHours' && cure.everyHours != null ? cure.everyHours * 3600 : undefined,
    };
    set((s) => ({ curePicker: null, sheet: { type: 'medication', confirm: true }, te: { ...s.te, ...patch } }));
  },
  expandMedicationLog: () => set({ sheet: { type: 'medication' } }),
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/store/useAppStore.test.ts -t "logMedicationFromCure|confirm sheet|expandMedicationLog"`
Expected: PASS (4 passed).

- [ ] **Step 7: Run the full store test file to check for regressions**

Run: `npx vitest run src/store/useAppStore.test.ts`
Expected: PASS (no failures). If `Entry` is now unused in the test file, that is fine; it is still used by the save case above.

- [ ] **Step 8: Commit**

```bash
git add src/store/useAppStore.ts src/store/useAppStore.test.ts
git commit -m "feat(cures): confirm before logging a treatment dose (store)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011AoP8QsJXJvDBFxTkdJVrz"
```

---

### Task 2: LogSheet confirm mode (summary, hidden notes/tags, Edit button)

**Files:**
- Modify: `src/features/log/LogSheet.tsx`

**Interfaces:**
- Consumes from Task 1: `sheet.confirm`, `expandMedicationLog()`.

This task is presentational React Native; the repo has no component tests, so it is verified by `npx tsc --noEmit` plus a visual check in the running app. There is no failing-test step.

- [ ] **Step 1: Read `expandMedicationLog` from the store and derive confirm mode**

In `src/features/log/LogSheet.tsx`, add a store read alongside the other `useAppStore` selectors in `LogSheet` (near `:453`, next to `const closeSheet = ...`):

```tsx
  const expandMedicationLog = useAppStore((s) => s.expandMedicationLog);
```

Then, just after the existing `const label = ACTIVITY_LABEL[type];` line (`~:464`), add:

```tsx
  // Confirm mode: the medication sheet opened from a saved treatment. It shows a
  // read-only treatment summary + the time picker only; "Edit" expands it into
  // the full form. `sheet` is non-null here (guarded above).
  const confirmMode = type === 'medication' && !!sheet.confirm;
  const medDoseLabel = [te.medDosage != null ? String(te.medDosage) : '', te.medUnit].filter(Boolean).join(' ');
```

- [ ] **Step 2: Swap the medication field for a read-only summary in confirm mode**

Replace the existing medication field block (`~:791-801`):

```tsx
        {type === 'medication' && (
          <MedicationField
            name={te.medName}
            dosage={te.medDosage}
            unit={te.medUnit}
            color={color}
            onName={(v) => setTE({ medName: v })}
            onDosage={(v) => setTE({ medDosage: v })}
            onUnit={(v) => setTE({ medUnit: v })}
          />
        )}
```

with the confirm-aware version:

```tsx
        {type === 'medication' &&
          (confirmMode ? (
            <>
              <FieldLabel>Treatment</FieldLabel>
              <View
                style={{
                  backgroundColor: t.surface,
                  borderWidth: 1.5,
                  borderColor: t.line,
                  borderRadius: 16,
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  marginBottom: 16,
                }}
              >
                <Txt weight={700} size={16.5}>
                  {te.medName}
                </Txt>
                {medDoseLabel ? (
                  <Txt weight={500} size={13.5} color={t.dim} style={{ marginTop: 2 }}>
                    {medDoseLabel}
                  </Txt>
                ) : null}
              </View>
            </>
          ) : (
            <MedicationField
              name={te.medName}
              dosage={te.medDosage}
              unit={te.medUnit}
              color={color}
              onName={(v) => setTE({ medName: v })}
              onDosage={(v) => setTE({ medDosage: v })}
              onUnit={(v) => setTE({ medUnit: v })}
            />
          ))}
```

- [ ] **Step 3: Hide the Notes section in confirm mode**

Change the notes block's condition (`~:840`) from:

```tsx
        {type !== 'bath' && type !== 'note' && (
```

to:

```tsx
        {type !== 'bath' && type !== 'note' && !confirmMode && (
```

- [ ] **Step 4: Hide the Tags field in confirm mode**

Replace the unconditional `TagField` (`~:871`):

```tsx
        <TagField color={color} tags={tags} selected={te.tags} onToggle={toggleTag} onCreate={createTag} />
```

with:

```tsx
        {!confirmMode && (
          <TagField color={color} tags={tags} selected={te.tags} onToggle={toggleTag} onCreate={createTag} />
        )}
```

- [ ] **Step 5: Add the `Edit` button to the save bar**

In the save bar (`~:875`), the `Delete` button renders only when `editingId` is set; confirm mode is always a new entry, so the two never coexist. Add the `Edit` button immediately after the `{editingId && ( ... )}` Delete block and before the `save` `Pressable` (`~:889`):

```tsx
        {confirmMode && (
          <Pressable
            onPress={expandMedicationLog}
            accessibilityRole="button"
            accessibilityLabel="Edit the dose details"
            style={(s) => [
              { height: 58, paddingHorizontal: 20, borderRadius: 18, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
              isHovered(s) && { backgroundColor: t.elevated },
            ]}
          >
            <Txt unselectable weight={800} size={16} color={t.text}>
              Edit
            </Txt>
          </Pressable>
        )}
```

The `Save medication` button is unchanged: with no `editingId` / `fromTimerId` and a point medication draft, `saveLabel` already resolves to `Save medication`.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Visual check in the app**

Start the app (`npm run web`, or the platform in use), open the Medication tile for a child that has an active treatment today, and confirm:
- Tapping a treatment opens the sheet showing the treatment name + dose (read-only) and the time picker, with `Edit` and `Save medication` in the bottom bar, and no notes/tags fields.
- `Save medication` logs the dose at the shown time and closes the sheet.
- `Edit` reveals the full editable form (name, amount, unit, notes, tags, pre-filled) and the `Edit` button disappears; `Save medication` still saves.

- [ ] **Step 8: Commit**

```bash
git add src/features/log/LogSheet.tsx
git commit -m "feat(cures): confirm modal (summary + time + Edit) for treatment doses

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011AoP8QsJXJvDBFxTkdJVrz"
```

---

## Notes for the implementer

- `openSheet('medication')` seeds a blank point draft (`shape: 'point'`, `agoMin: 0`, `medName: ''`) and sets `editingId`/`fromTimerId` to `null`; `logMedicationFromCure` overlays the cure fields and adds `confirm: true`, so `TimeEntry` renders its "When" panel and `save()` builds a point medication entry at `teEnd(te, now)`.
- `save()` sets `sheet: null` on success, so both the Save path and the whole sheet close cleanly; the `confirm` flag never lingers.
- "Log manually" in `CurePickerSheet` is untouched: it still calls `openSheet('medication')` for a blank form (no `confirm`).
