# Fold "Ended earlier…" into the timer edit sheet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the standalone "Ended earlier…" stop control on the timers card and make the edit sheet's "now" end pill tappable, so editing it to an earlier time and saving stops the timer and logs the entry.

**Architecture:** The store already does the work: `save()` short-circuits to `saveTimerDetails()` while `fromTimerId && te.ongoing`, and falls through to the entry-creation path (which drops the timer and its server mirror) once `ongoing` flips false. `setEndedAbs`/`setEnded` already flip `ongoing` false. The change is almost entirely UI: remove the duplicate control on the timers screen, un-fence the end pill in `TimeEntry`, add a timer-specific end panel, and have the save button announce the pinned end. A final store task retires the now-dead `endMs` parameter of `stopTimer`.

**Tech Stack:** React Native + Expo (v56), TypeScript (strict), Zustand v5, Vitest. Source spec: `docs/superpowers/specs/2026-07-17-timer-end-fold-into-edit-design.md`.

## Global Constraints

- **Expo v56:** Per `AGENTS.md`, consult https://docs.expo.dev/versions/v56.0.0/ before writing code. This change introduces **no new Expo API surface**: it uses `Pressable`, `View`, and existing in-repo components (`Chip`, `TimeAdjuster`, `Txt`), all already imported in the touched files.
- **Zustand v5 selector rule:** never return a new reference from a `useAppStore` selector (no inline `.filter`/`.map` inside a selector). Select raw state and derive in render. The new code adds no new selectors; the `endAnchors.map` stays in render, not in a selector.
- **Copy/comment style:** match the surrounding code idiom. No em-dashes in new UI copy or comments; the codebase uses `·`, commas, and colons.
- **Discipline:** DRY, YAGNI, TDD where a test harness exists, frequent commits. The repo's automated tests are store-level (`src/store/useAppStore.test.ts`, Vitest). `TimeEntry`, `LogSheet`, and the timers screen have **no** component tests, so their tasks are gated on typecheck + lint + a manual smoke check rather than red-green.
- **Verification commands (repo-wide):**
  - Tests: `npx vitest run src/store/useAppStore.test.ts`
  - Typecheck: `npx tsc --noEmit`
  - Lint: `npm run lint`

---

### Task 1: Store contract tests — prove `save()` folds the end into the entry

Lock in the behavior every later UI task leans on: editing a running timer's end to a fixed time and saving stops the timer and logs an entry at that end; tapping "Still running" keeps it live. The store already implements this (see the spec's "What already works"), so these are characterization tests that pass against current code. They also guard the contract against future regressions.

**Files:**
- Test: `src/store/useAppStore.test.ts` (add two `it` blocks inside the existing `describe('edit a running timer')`, which currently spans lines 2086-2126)

**Interfaces:**
- Consumes (existing store API, unchanged): `openTimerEdit(id)`, `setEndedAbs(ms)`, `setOngoing()`, `save()`; selectors already imported in the test file (`teStart`, `teEnd`, `isActive`, `teDurationMin`). Test helpers already in file: `s()` (= `useAppStore.getState()`), `NOW`, `M` (ms-per-minute), and the `beforeEach` reset (server mode, `selectedChildId: 'c1'`, empty `timers`/`entries`).
- Produces: nothing consumed by later tasks; this is a guard.

- [ ] **Step 1: Add the two characterization tests**

Insert these two `it` blocks immediately before the closing `});` of `describe('edit a running timer', ...)` (currently line 2126, right after the `'closing the timer-edit sheet keeps the timer running'` test):

```typescript
  it('editing the end to an earlier time then saving stops the timer and logs an entry at that end', () => {
    useAppStore.setState({
      timers: [{ id: 't1', activity: 'sleep', name: 'Sleep', start: NOW - 40 * M, saveAs: 'sleep' }],
    });
    s().openTimerEdit('t1');
    s().setEndedAbs(NOW - 5 * M); // pin an earlier end; flips ongoing:false
    s().save();
    expect(s().timers).toHaveLength(0); // source timer consumed
    expect(s().entries).toHaveLength(1);
    const e = s().entries[0] as Extract<Entry, { type: 'sleep' }>;
    expect(e.start).toBe(NOW - 40 * M); // original timer start preserved
    expect(e.end).toBe(NOW - 5 * M); // logged at the pinned end
    expect(s().fromTimerId).toBeNull();
  });

  it('editing the end then tapping Still running keeps the timer live and creates no entry', () => {
    useAppStore.setState({
      timers: [{ id: 't1', activity: 'sleep', name: 'Sleep', start: NOW - 40 * M, saveAs: 'sleep' }],
    });
    s().openTimerEdit('t1');
    s().setEndedAbs(NOW - 5 * M);
    s().setOngoing(); // "Still running" — back to live
    s().save();
    expect(s().timers).toHaveLength(1); // still running (saveTimerDetails path)
    expect(s().entries).toHaveLength(0); // no entry created
    expect(s().timers[0].start).toBe(NOW - 40 * M);
    expect(s().sheet).toBeNull();
    expect(s().fromTimerId).toBeNull();
  });
```

- [ ] **Step 2: Run the new tests — expect PASS (characterization, not red-green)**

Run: `npx vitest run src/store/useAppStore.test.ts -t "edit a running timer"`
Expected: PASS. These tests describe behavior the store already has (`save()` delegates to `saveTimerDetails` while `ongoing`, and builds an entry + drops the timer once `ongoing` is false). If either FAILS, stop: the store contract differs from the spec's "What already works" and the rest of the plan needs revisiting before continuing.

- [ ] **Step 3: Run the full store suite to confirm no collateral breakage**

Run: `npx vitest run src/store/useAppStore.test.ts`
Expected: PASS (all existing tests plus the two new ones).

- [ ] **Step 4: Commit**

```bash
git add src/store/useAppStore.test.ts
git commit -m "test(timers): lock the save()-folds-end-into-entry contract"
```

---

### Task 2: Timers screen — delete the "Ended earlier…" control

Pure deletion. Removes the disclosure button, its ephemeral editor, the state that drives it, and the two format imports it alone used. This also removes the only remaining call site that passes a second argument to `stopTimer` (`stopTimer(tm.id, endCandidate)`), which Task 5 depends on.

**Files:**
- Modify: `src/app/(tabs)/timers.tsx`

**Interfaces:**
- Consumes: `stopTimer(id)` (the 1-arg form) at the untouched card "Stop & save" button — unchanged.
- Produces: after this task, no caller anywhere passes `endMs` to `stopTimer`. Task 5 relies on this.

- [ ] **Step 1: Drop the two now-unused format imports**

Edit line 14. Change:

```typescript
import { fmtAgo, fmtClock, fmtDur, fmtElapsedClock } from '@/lib/format';
```

to:

```typescript
import { fmtAgo, fmtElapsedClock } from '@/lib/format';
```

- [ ] **Step 2: Delete the `endEditFor` / `endCandidate` state**

Delete these five lines (currently 70-74):

```typescript
  // timer id whose ephemeral "Ended earlier…" stop editor is expanded — never
  // persisted; collapsing (or stopping) discards it without touching the timer.
  const [endEditFor, setEndEditFor] = useState<string | null>(null);
  // candidate end (ms) picked in that editor, only meaningful while it's open
  const [endCandidate, setEndCandidate] = useState(0);
```

The line above them (`const [exactFor, setExactFor] = useState<string | null>(null);`) and the `const body = (` line below stay.

- [ ] **Step 3: Delete the "Ended earlier…" Pressable and its editor block**

Remove the entire span currently at lines 226-312: the `<Pressable onPress={() => { if (endEditFor === tm.id) {...`  disclosure button through the closing `)}` of the `{endEditFor === tm.id && (` editor block. After removal, the action-row `</View>` (currently line 224) is immediately followed by the save-options row. The result reads:

```typescript
                <Pressable
                  onPress={() => stopTimer(tm.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Stop and save ${tm.name} timer`}
                  style={(s) => [
                    { flex: 1.7, height: 50, borderRadius: 14, backgroundColor: color, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, cursor: 'pointer' },
                    isHovered(s) && { boxShadow: t.shadow },
                  ]}
                >
                  <Txt unselectable weight={800} size={14.5} color={t.onActivity} style={{ textAlign: 'center' }}>
                    Stop &amp; save
                  </Txt>
                </Pressable>
              </View>

              <View style={{ flexDirection: 'row', gap: 7, marginTop: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                {TIMER_SAVE_OPTIONS.map((o) => {
```

(The `<View ... marginTop: 10 ...>` opening the `TIMER_SAVE_OPTIONS` map is the existing save-as chip row; nothing about it changes.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. `fmtClock`, `fmtDur`, `endEditFor`, `setEndEditFor`, `endCandidate`, `setEndCandidate` now have zero references; if tsc reports any of them as still-used, a deletion was incomplete.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: clean (no unused-variable / unused-import warnings for the removed symbols).

- [ ] **Step 6: Manual smoke check**

Start the app (`npm run web`, or your usual target). Start a timer, open the Timers tab. The running-timer card shows the "Started earlier?" nudges + "Exact…", then the Discard / Edit / **Stop & save** action row, then the save-as chips. There is **no** "Ended earlier…" pill between the action row and the chips. "Stop & save" still stops at now.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(tabs)/timers.tsx"
git commit -m "feat(timers): remove the standalone Ended-earlier stop control"
```

---

### Task 3: TimeEntry — make the end pill tappable and add the timer end panel

Un-fence the end value in the edit sheet (it is currently rendered as dead "now"/clock text for timer edits) so it becomes a focusable pill, and add a timer-specific end panel that lets the user edit "now" downward from a live timer.

**Files:**
- Modify: `src/features/log/TimeEntry.tsx`

**Interfaces:**
- Consumes (all already declared/imported in this file): store setters `setEnded`, `setEndedAbs`, `setOngoing`; the `timerEdit` boolean (`fromTimerId != null`); render-scope values `start` (`teStart`, typed `number | null`), `end` (`teEnd`), `now`, `endActive` (`isActive(te.order, 'end')`), `endAnchors`, the `MIN` constant, `fmtAgoShort`, and components `Chip`, `TimeAdjuster`, `Txt`, `ValuePill`.
- Produces: a tappable end pill and a panel that call the existing store setters. No new store API.

- [ ] **Step 1: Update the stale timer-edit comment**

The comment above `const timerEdit = ...` (currently lines 103-106) claims Ended does not apply to a timer edit. That is what this task changes. Replace:

```typescript
  // Editing a running timer (opened via openTimerEdit): a running timer has no
  // end/duration, so Ended does not apply. Only Start + Lasted (which stops and
  // logs it on save) are focusable. Gating on fromTimerId leaves normal
  // new-entry sheets untouched.
```

with:

```typescript
  // Editing a running timer (opened via openTimerEdit): Start, End and Lasted are
  // all focusable. Editing End or Lasted to a fixed value flips ongoing false so
  // save() stops the timer and logs it; leaving it ongoing saves details only.
  // Gating on fromTimerId leaves normal new-entry sheets untouched.
```

- [ ] **Step 2: Delete the `timerEdit` dead-text branch on the end pill**

In the readout row (currently lines 176-184), the end value is special-cased to plain `Txt` when `timerEdit`. Remove that branch so control falls through to the pills that already exist. Replace:

```typescript
                {timerEdit ? (
                  <Txt weight={800} size={17} tracking={-0.3} color={t.dim}>
                    {te.ongoing ? 'now' : fmtClock(end)}
                  </Txt>
                ) : te.ongoing ? (
                  <ValuePill big label="now" color={color} active={editing === 'end'} onPress={() => focus('end')} />
                ) : (
                  <ValuePill big label={fmtClock(end)} color={color} active={editing === 'end'} dimmed={derived === 'end'} onPress={() => focus('end')} />
                )}
```

with:

```typescript
                {te.ongoing ? (
                  <ValuePill big label="now" color={color} active={editing === 'end'} onPress={() => focus('end')} />
                ) : (
                  <ValuePill big label={fmtClock(end)} color={color} active={editing === 'end'} dimmed={derived === 'end'} onPress={() => focus('end')} />
                )}
```

- [ ] **Step 3: Add the timer-specific end panel**

The general end panel (currently lines 220-250) is already gated `isInterval && !timerEdit && editing === 'end'`, so it is not touched. Add a parallel timer panel. A separate block is needed rather than widening the general one, because the general panel hides its `TimeAdjuster` while `ongoing`, and editing "now" downward from a live timer is the whole point.

Anchor on the (unique) start-panel opener and prepend the new block before it. Replace:

```typescript
      {isInterval && editing === 'start' && (
```

with:

```typescript
      {isInterval && timerEdit && editing === 'end' && (
        <View style={{ gap: 10, marginBottom: 4 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip
              label="Now"
              color={color}
              selected={!te.ongoing && endActive && te.endAbs == null && te.endAgoMin === 0}
              onPress={() => setEnded(0)}
            />
            <Chip label="Still running" color={color} selected={!!te.ongoing} onPress={setOngoing} />
            {endAnchors.map((a) => (
              <Chip
                key={a.label}
                label={`${a.label} (${fmtAgoShort(a.min)})`}
                color={color}
                onPress={() => setEndedAbs(now - a.min * MIN)}
              />
            ))}
          </View>
          <Txt weight={500} size={12} color={t.dim}>
            {te.ongoing ? 'Set an end to stop the timer and log it.' : 'Saving stops the timer and logs it.'}
          </Txt>
          <TimeAdjuster
            mode="clock"
            value={end}
            now={now}
            color={color}
            showRelative
            onChange={(ms) => setEndedAbs(Math.min(now, Math.max(start as number, ms)))}
          />
        </View>
      )}

      {isInterval && editing === 'start' && (
```

Notes on the choices, for the reviewer:
- The helper line is conditional (mirroring the existing timer "lasted" panel at lines 301-311) rather than the single fixed string in the spec, because while `ongoing` the save button reads "Save details" and saving does **not** stop the timer, so a flat "Saving stops the timer…" would be wrong in that sub-state. The non-ongoing string is verbatim from the spec.
- `showRelative` matches the general end panel's `TimeAdjuster` UX. The `Math.min(now, Math.max(start, ms))` clamp is the spec's `[start, now]`; `TimeAdjuster` also clamps forward motion to `now` on its own, so the upper bound is belt-and-suspenders.
- The "Still running" chip calls plain `setOngoing` (not the general panel's `goOngoing`, which moves focus to `start`); staying in the end panel matches the timer "lasted" panel's behavior.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. In particular `fmtClock` is still imported and used (the non-timer pill still uses it), so its import must remain.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 6: Manual smoke check**

In the running app: start a timer, tap **Edit** on its card. In the sheet:
1. The end value now renders as a tappable "now" pill (was dead grey text).
2. Tap it. The panel shows **Now** / **Still running** (selected) / any end anchors, a helper line, and a clock adjuster. Nudge the clock earlier: the end pill fills with the pinned time (not dimmed), the "lasted" summary re-derives, and the save button reads "Stop & save".
3. Tap **Still running**: the pill returns to live "now" and the save button reads "Save details".
4. Tap **Now**: the pill returns to "now" (via `setEnded(0)`) and the button reads "Stop & save".

- [ ] **Step 7: Commit**

```bash
git add src/features/log/TimeEntry.tsx
git commit -m "feat(timers): make the edit sheet's end pill tappable with a timer end panel"
```

---

### Task 4: LogSheet — announce the pinned end on the save button

When a timer edit has a fixed past end pinned, the save button should say so.

**Files:**
- Modify: `src/features/log/LogSheet.tsx`

**Interfaces:**
- Consumes: `fmtClock` (new import), `te.endAbs`, `te.ongoing`, `fromTimerId` (all already read in this component).
- Produces: user-facing button copy only.

- [ ] **Step 1: Import `fmtClock`**

The file does not import from `@/lib/format` yet. Add the import between the `@/lib/color` and `@/lib/units` imports (currently around lines 16-17):

```typescript
import { hexA } from '@/lib/color';
import { fmtClock } from '@/lib/format';
import { fmtValue, toMetric, unitLabel } from '@/lib/units';
```

- [ ] **Step 2: Extend the `saveLabel` ternary**

Replace the current `saveLabel` (lines 210-218):

```typescript
  const saveLabel = editingId
    ? 'Save changes'
    : fromTimerId
      ? te.ongoing
        ? 'Save details'
        : 'Stop & save'
      : te.ongoing && te.shape === 'interval'
        ? 'Start live timer'
        : `Save ${label.toLowerCase()}`;
```

with:

```typescript
  const saveLabel = editingId
    ? 'Save changes'
    : fromTimerId
      ? te.ongoing
        ? 'Save details'
        : te.endAbs != null
          ? `Stop & save · ended ${fmtClock(te.endAbs)}`
          : 'Stop & save'
      : te.ongoing && te.shape === 'interval'
        ? 'Start live timer'
        : `Save ${label.toLowerCase()}`;
```

Keying on `te.endAbs != null` is exact: a `Now`-chip stop (`setEnded(0)`, which clears `endAbs`) and the pre-existing "lasted" route both keep the plain "Stop & save", while only an explicit pinned end shows the time.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: clean (the new `fmtClock` import is used).

- [ ] **Step 5: Manual smoke check**

Continuing from Task 3's flow: pin an earlier end via the clock adjuster or an anchor, and confirm the save button reads "Stop & save · ended HH:MM". Tap **Now** → "Stop & save". Tap **Still running** → "Save details". Then actually press the button with an earlier end pinned and confirm the timer disappears and an entry is logged ending at that time.

- [ ] **Step 6: Commit**

```bash
git add src/features/log/LogSheet.tsx
git commit -m "feat(timers): show the pinned end on the timer-edit save button"
```

---

### Task 5: Store — retire the dead `endMs` path on `stopTimer`

With the disclosure gone (Task 2), `stopTimer`'s `endMs` parameter has no callers. The new route never touches `stopTimer` — it goes through `save()`. Leaving `endMs` would ship an untriggerable second stop path with its own clamping rules, free to drift from the sheet's (see `data/timers.ts:20`, which records that this feature already left one round of dead code behind). Narrow the signature and delete the tests that cover only the dead argument.

**Depends on Task 2** (the last 2-arg caller, `timers.tsx`, must be gone) so that `npx tsc --noEmit` stays green after the signature narrows.

**Files:**
- Modify: `src/store/useAppStore.ts` (interface at 275-277; implementation at 1927-1935 and 1959-1963; import at line 69)
- Modify: `src/store/useAppStore.test.ts` (delete the `describe('stopTimer(id, endMs?) …')` block at 1964-2026; remove the `fmtClock` import at line 26)

**Interfaces:**
- Produces: `stopTimer: (id: string) => void` — the final 1-arg signature. No consumers change (all remaining callers already pass one argument).

- [ ] **Step 1: Delete the `endMs` test block**

Remove the entire `describe('stopTimer(id, endMs?) — ephemeral "Ended earlier…" stop flow', () => { … });` block (currently lines 1964-2026). Every test in it exercises the `endMs` argument; the surviving "end at now" behavior is already covered by `describe('stopTimer')` (line 663) and the childId/server-sync suites, which all call `stopTimer('t1')` with one argument.

- [ ] **Step 2: Remove the now-unused `fmtClock` test import**

`fmtClock` was used only in the block just deleted (its "back-dated toast" assertion). Delete the import (currently line 26):

```typescript
import { fmtClock } from '@/lib/format';
```

(The two tests added in Task 1 do not use `fmtClock`.)

- [ ] **Step 3: Narrow the `stopTimer` interface signature and its doc comment**

In `src/store/useAppStore.ts`, replace (currently lines 275-277):

```typescript
  /** Stop a running timer and log it. `endMs`, if given (from the ephemeral
   * "Ended earlier…" editor), is clamped into `[start, now]`; omitted = now. */
  stopTimer: (id: string, endMs?: number) => void;
```

with:

```typescript
  /** Stop a running timer at now and log it. */
  stopTimer: (id: string) => void;
```

- [ ] **Step 4: Drop the `endMs` clamp in the implementation**

Replace the implementation head (currently lines 1927-1935):

```typescript
  stopTimer: (id, endMs) => {
    const s = get();
    const tm = s.timers.find((t) => t.id === id);
    if (!tm) return;
    const saveAs = tm.saveAs;
    const now = Date.now();
    // An explicit past end (from the ephemeral "Ended earlier…" editor) is
    // clamped into [start, now]; otherwise end at now.
    const resolvedEnd = endMs != null ? Math.min(now, Math.max(tm.start, endMs)) : now;
```

with:

```typescript
  stopTimer: (id) => {
    const s = get();
    const tm = s.timers.find((t) => t.id === id);
    if (!tm) return;
    const saveAs = tm.saveAs;
    const now = Date.now();
    const resolvedEnd = now;
```

(`resolvedEnd` stays as a named local; it is still referenced by every entry-construction branch below at `end: resolvedEnd` / `buildSleepEntry(tm, resolvedEnd, …)`.)

- [ ] **Step 5: Drop the back-dated toast wording**

Replace the toast tail (currently lines 1959-1963):

```typescript
    const queued = s.offline && !!s.connection && s.connection.mode === 'server';
    // Only call out the resolved end when the caller asked for a back-dated
    // stop — ending "now" needs no confirmation of what time it is.
    const backdated = endMs != null ? ` · ended ${fmtClock(resolvedEnd)}` : '';
    get().showToast(queued ? `Saved · queued offline${backdated}` : `Saved as ${ACTIVITY_LABEL[saveAs].toLowerCase()}${backdated}`);
  },
```

with:

```typescript
    const queued = s.offline && !!s.connection && s.connection.mode === 'server';
    get().showToast(queued ? 'Saved · queued offline' : `Saved as ${ACTIVITY_LABEL[saveAs].toLowerCase()}`);
  },
```

- [ ] **Step 6: Remove the now-unused `fmtClock` store import**

`fmtClock` was used only in the back-dated toast just removed. Delete the import (currently line 69):

```typescript
import { fmtClock } from '@/lib/format';
```

- [ ] **Step 7: Run the store suite**

Run: `npx vitest run src/store/useAppStore.test.ts`
Expected: PASS. The `endMs` block is gone; the two Task 1 tests and all existing coverage (including the ongoing route `save()` → `saveTimerDetails` at "edit a running timer" and "saveTimerDetails: persisting edits to a running timer") pass unchanged.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. This is the gate that proves no caller still passes `endMs`; if it fails on a 2-arg `stopTimer(…)`, Task 2 was not fully applied.

- [ ] **Step 9: Lint**

Run: `npm run lint`
Expected: clean (no unused `fmtClock` import in either file).

- [ ] **Step 10: Commit**

```bash
git add src/store/useAppStore.ts src/store/useAppStore.test.ts
git commit -m "refactor(timers): retire stopTimer's unused endMs parameter"
```

---

## Final verification

- [ ] Full test run: `npx vitest run` → PASS.
- [ ] Typecheck: `npx tsc --noEmit` → clean.
- [ ] Lint: `npm run lint` → clean.
- [ ] End-to-end in the app: start a timer → Edit → tap the "now" end pill → set an earlier end via the clock adjuster → button reads "Stop & save · ended HH:MM" → press it → the timer disappears from the Timers tab and an entry is logged ending at that time. Repeat, choosing "Still running" instead, and confirm the timer stays live ("Save details" saves metadata only). Confirm the timers card no longer shows an "Ended earlier…" control.

## Self-Review (checked against the spec)

**Spec coverage**
- §1 Timers screen (delete disclosure + editor, remove `endEditFor`/`endCandidate`, drop `fmtClock`/`fmtDur` imports) → Task 2, steps 1-3.
- §2 TimeEntry (delete the `timerEdit ?` dead-text branch; add the timer end panel gated `isInterval && timerEdit && editing === 'end'` with Now / Still running / anchors / helper / clamped `TimeAdjuster`) → Task 3, steps 2-3. Stale comment updated (step 1).
- §3 LogSheet (`saveLabel` reads "Stop & save · ended …" when `fromTimerId && !te.ongoing && te.endAbs != null`; add `fmtClock` import) → Task 4.
- §4 Store (narrow `stopTimer` to `(id)`, drop the clamp so `resolvedEnd = now`, update the comments at the signature and impl) → Task 5, steps 3-5. The `data/timers.ts:20` dead-code precedent is the rationale, not a code change, so no task touches that file.
- Testing (delete the `stopTimer(id, endMs?)` describe; add the two `setEndedAbs → save()` cases; keep the ongoing route passing) → Task 1 (adds) + Task 5 steps 1-2 (deletes), with the ongoing route left untouched.
- Out of scope (general end panel, the "lasted" route, server mirroring) → untouched; the general panel keeps its `!timerEdit` gate, the "lasted" panels are unchanged, and server mirroring rides the existing entry-creation path.

**Consequential edits the spec implies but does not spell out** (all included so the tree stays green): removing the orphaned `fmtClock` import from the store (Task 5 step 6) and from the test file (Task 5 step 2) after the back-dated toast and the `endMs` tests are gone; deleting the back-dated toast line itself (Task 5 step 5).

**Placeholder scan:** none — every code step carries complete code; every command step states the exact command and expected result.

**Type/name consistency:** `stopTimer(id)` is used consistently after narrowing; `setEnded`/`setEndedAbs`/`setOngoing`/`save`/`openTimerEdit` names match the store; `te.endAbs`/`te.endAgoMin`/`te.ongoing` match `TimeEntryState`; `endActive`, `endAnchors`, `start`, `end`, `now`, `MIN`, `fmtAgoShort`, `Chip`, `TimeAdjuster` all already exist in `TimeEntry.tsx` render scope.
