# Clock-first Time Panels with a Quick set Strip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In each `TimeEntry` editing panel, render the exact time editor first and demote the smart anchors into a compact, one-line, horizontally-scrollable "Quick set" strip, so the clock leads without the anchors becoming an overlooked footer.

**Architecture:** Add two pure label helpers to `src/lib/format.ts` (unit-tested). Then, in `src/features/log/TimeEntry.tsx`, add two small local presentational helpers (`StripChip`, `QuickSetStrip`) and reorder the four affected panels so `TimeAdjuster` comes first and the anchors follow inside the strip. No store, selector, or clamping logic changes.

**Tech Stack:** TypeScript, React 19, React Native 0.85 (core `ScrollView`), react-native-web 0.21, Expo SDK 56, Vitest.

Spec: `docs/superpowers/specs/2026-07-17-time-entry-clock-first-quick-set-design.md`

## Global Constraints

- No new dependency. Use React Native's core `ScrollView`; do not add any gradient or masked-view library.
- Per `AGENTS.md`: check the versioned Expo v56 docs (https://docs.expo.dev/versions/v56.0.0/) before writing code.
- UI copy separator is the middot `·` (already used in this file, e.g. `running ·`). Never use em-dashes.
- Do not change any store setter, anchor-visibility selector, or clamping expression. Only container, order, chip sizing, and label text change.
- Scope is exactly four panels: Start, regular End, timer-edit End, and the non-interval "When" panel. Leave both "Lasted" (duration) panels untouched.

---

## File Structure

- `src/lib/format.ts` — add `ANCHOR_LABEL` (shared base copy) and `anchorLabel(base, agoMin?)` (composes the compact chip label). Pure, no React.
- `src/lib/format.test.ts` — add Vitest coverage for the two new exports.
- `src/features/log/TimeEntry.tsx` — add `StripChip` and `QuickSetStrip` local helpers; reorder the four panels; shorten `endAnchors` base labels; drop the now-unused `fmtAgoShort` import.

---

## Task 1: Pure anchor-label helpers in `format.ts`

**Files:**
- Modify: `src/lib/format.ts` (add after `fmtAgoShort`, around line 45)
- Test: `src/lib/format.test.ts`

**Interfaces:**
- Consumes: existing `fmtAgoShort(min: number): string` from the same file.
- Produces:
  - `ANCHOR_LABEL` — a `const` object: `{ feedEnded: 'Feed ended', woke: 'Woke', diaper: 'Diaper', feedStarted: 'Feed started', sleepStarted: 'Sleep started' }`.
  - `anchorLabel(base: string, agoMin?: number): string` — returns `base` when `agoMin` is `undefined`, otherwise `` `${base} · ${fmtAgoShort(agoMin)}` ``.

- [ ] **Step 1: Write the failing test**

Add to the imports at the top of `src/lib/format.test.ts` (extend the existing `@/lib/format` import list) the two new names `ANCHOR_LABEL` and `anchorLabel`, then append this block to the file:

```ts
describe('anchorLabel / ANCHOR_LABEL', () => {
  it('appends a middot + short ago when given minutes', () => {
    expect(anchorLabel(ANCHOR_LABEL.feedEnded, 120)).toBe('Feed ended · 2h');
    expect(anchorLabel(ANCHOR_LABEL.woke, 45)).toBe('Woke · 45m');
    expect(anchorLabel(ANCHOR_LABEL.feedStarted, 78)).toBe('Feed started · 1h18m');
  });
  it('returns the base label unchanged when no ago is given', () => {
    expect(anchorLabel(ANCHOR_LABEL.diaper)).toBe('Diaper');
    expect(anchorLabel(ANCHOR_LABEL.woke)).toBe('Woke');
  });
});
```

The full import at the top should read:

```ts
import {
  ageMonths,
  ageStr,
  ANCHOR_LABEL,
  anchorLabel,
  dayGroupLabel,
  fmtAgo,
  fmtAgoShort,
  fmtClock,
  fmtDur,
  fmtElapsedClock,
  relDayLabel,
} from '@/lib/format';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- format`
Expected: FAIL — `ANCHOR_LABEL`/`anchorLabel` are not exported (import resolves to `undefined`, assertions throw).

- [ ] **Step 3: Write the minimal implementation**

In `src/lib/format.ts`, immediately after the `fmtAgoShort` function (after line 45), add:

```ts
/**
 * Base copy for the Quick set anchor chips, shared across the time panels so the
 * wording stays identical everywhere (e.g. "Diaper" reads the same in the start,
 * end, and point-event panels).
 */
export const ANCHOR_LABEL = {
  feedEnded: 'Feed ended',
  woke: 'Woke',
  diaper: 'Diaper',
  feedStarted: 'Feed started',
  sleepStarted: 'Sleep started',
} as const;

/**
 * Compose a compact Quick set chip label. With an "ago" value it appends the
 * short duration after a middot: anchorLabel('Feed ended', 120) -> "Feed ended · 2h".
 * Without one it returns the base unchanged: anchorLabel('Woke') -> "Woke".
 */
export function anchorLabel(base: string, agoMin?: number): string {
  return agoMin == null ? base : `${base} · ${fmtAgoShort(agoMin)}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- format`
Expected: PASS — all `format` tests green, including the new `anchorLabel / ANCHOR_LABEL` block.

- [ ] **Step 5: Commit**

```bash
git add src/lib/format.ts src/lib/format.test.ts
git commit -m "feat(format): add shared anchorLabel helper for Quick set chips"
```

---

## Task 2: Clock-first reorder + Quick set strip in `TimeEntry.tsx`

**Files:**
- Modify: `src/features/log/TimeEntry.tsx`

**Interfaces:**
- Consumes: `ANCHOR_LABEL`, `anchorLabel` from Task 1; existing `Chip`, `TimeAdjuster`, `Txt`, `useTheme`, and all existing store setters/selectors already imported in this file.
- Produces (local to this file, not exported):
  - `StripChip(props: ComponentProps<typeof Chip>)` — a `Chip` preset to compact sizing (`padV={8} padH={12} fontSize={13} radius={11}`), caller props spread last.
  - `QuickSetStrip({ children }: { children: ReactNode })` — a dim `Quick set` label above a horizontal `ScrollView` of chips.

This task is presentational: it reorders JSX and swaps the anchor container. There is no component/render-test harness in the repo (all tests are pure-logic `.test.ts`), so its verification is typecheck + lint + the existing suite staying green + a functional web check. The label logic it depends on is already covered by Task 1.

- [ ] **Step 1: Update the three import lines**

At the top of `src/features/log/TimeEntry.tsx`:

Change:
```ts
import { useState } from 'react';
import { Pressable, View } from 'react-native';
```
to:
```ts
import { useState, type ComponentProps, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
```

Change the `@/lib/format` import from:
```ts
import { dayGroupLabel, fmtAgoShort, fmtClock, fmtDur, relDayLabel } from '@/lib/format';
```
to (drop `fmtAgoShort`, which is no longer used directly here; add the two new helpers):
```ts
import { ANCHOR_LABEL, anchorLabel, dayGroupLabel, fmtClock, fmtDur, relDayLabel } from '@/lib/format';
```

- [ ] **Step 2: Add the `StripChip` and `QuickSetStrip` helpers**

Immediately after the `ValuePill` component definition (after its closing `}` near line 96) and before `export function TimeEntry(`, add:

```tsx
/** A Chip preset to the compact sizing used inside the Quick set strip. */
function StripChip(props: ComponentProps<typeof Chip>) {
  return <Chip padV={8} padH={12} fontSize={13} radius={11} {...props} />;
}

/**
 * The smart anchors as a single-line, horizontally-scrollable strip beneath the
 * exact editor. One line tall regardless of anchor count; when the chips
 * overflow, the trailing chip peeks at the right edge as the "swipe for more"
 * cue. A dim "Quick set" label keeps the shortcuts discoverable below the clock.
 */
function QuickSetStrip({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Txt weight={600} size={11.5} color={t.dim} tracking={0.2}>
        Quick set
      </Txt>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ flexDirection: 'row', gap: 8, paddingRight: 4 }}
      >
        {children}
      </ScrollView>
    </View>
  );
}
```

- [ ] **Step 3: Shorten the `endAnchors` base labels**

Replace the `endAnchors` array (currently lines 150-161) so its `label` fields use the shared short bases. The `.filter(...)` tail is unchanged:

```tsx
  // Ended anchors: "this ended when the next thing started". Keep only those
  // that land after the current start (and not in the future).
  const endAnchors = (
    isInterval
      ? [
          feedStart != null ? { min: feedStart, label: ANCHOR_LABEL.feedStarted } : null,
          sleepStart != null ? { min: sleepStart, label: ANCHOR_LABEL.sleepStarted } : null,
          lastDiaper != null ? { min: lastDiaper, label: ANCHOR_LABEL.diaper } : null,
        ]
      : []
  ).filter(
    (a): a is { min: number; label: string } =>
      a != null && endAnchorVisible(now - a.min * MIN, start as number, now),
  );
```

- [ ] **Step 4: Rewrite the regular End panel (clock first, strip below)**

Replace the whole `{isInterval && !timerEdit && editing === 'end' && ( ... )}` block (currently lines 216-246) with:

```tsx
      {isInterval && !timerEdit && editing === 'end' && (
        <View style={{ gap: 10, marginBottom: 4 }}>
          {!te.ongoing && (
            <TimeAdjuster
              mode="clock"
              value={end}
              now={now}
              color={color}
              showRelative
              onChange={(ms) => setEndedAbs(Math.max(ms, start as number))}
            />
          )}
          <QuickSetStrip>
            <StripChip
              label="Now"
              color={color}
              selected={!te.ongoing && endActive && te.endAbs == null && te.endAgoMin === 0}
              onPress={() => setEnded(0)}
            />
            <StripChip label="Still ongoing" color={color} selected={!!te.ongoing} onPress={goOngoing} />
            {endAnchors.map((a) => (
              <StripChip
                key={a.label}
                label={anchorLabel(a.label, a.min)}
                color={color}
                onPress={() => setEndedAbs(now - a.min * MIN)}
              />
            ))}
          </QuickSetStrip>
        </View>
      )}
```

- [ ] **Step 5: Rewrite the timer-edit End panel (clock first, caption, strip)**

Replace the whole `{isInterval && timerEdit && editing === 'end' && ( ... )}` block (currently lines 248-279) with:

```tsx
      {isInterval && timerEdit && editing === 'end' && (
        <View style={{ gap: 10, marginBottom: 4 }}>
          <TimeAdjuster
            mode="clock"
            value={end}
            now={now}
            color={color}
            showRelative
            onChange={(ms) => setEndedAbs(Math.min(now, Math.max(start as number, ms)))}
          />
          <Txt weight={500} size={12} color={t.dim}>
            {te.ongoing ? 'Set an end to stop the timer and log it.' : 'Saving stops the timer and logs it.'}
          </Txt>
          <QuickSetStrip>
            <StripChip
              label="Now"
              color={color}
              selected={!te.ongoing && endActive && te.endAbs == null && te.endAgoMin === 0}
              onPress={() => setEnded(0)}
            />
            <StripChip label="Still running" color={color} selected={!!te.ongoing} onPress={setOngoing} />
            {endAnchors.map((a) => (
              <StripChip
                key={a.label}
                label={anchorLabel(a.label, a.min)}
                color={color}
                onPress={() => setEndedAbs(now - a.min * MIN)}
              />
            ))}
          </QuickSetStrip>
        </View>
      )}
```

- [ ] **Step 6: Rewrite the Start panel (clock first, strip below)**

Replace the whole `{isInterval && editing === 'start' && ( ... )}` block (currently lines 281-324) with:

```tsx
      {isInterval && editing === 'start' && (
        <View style={{ gap: 10, marginBottom: 4 }}>
          <TimeAdjuster
            mode="clock"
            value={start as number}
            now={now}
            color={color}
            showRelative
            onChange={(ms) => setStartedAt(te.ongoing ? ms : Math.min(ms, end))}
          />
          <QuickSetStrip>
            <StripChip
              label="Now"
              color={color}
              selected={startActive && te.startAnchor === 'now'}
              onPress={() => setStartedAt(now, 'now')}
            />
            {lastFeed != null && (
              <StripChip
                label={anchorLabel(ANCHOR_LABEL.feedEnded, lastFeed)}
                color={color}
                selected={startActive && te.startAnchor === 'lastfeed'}
                onPress={() => setStartedAt(now - lastFeed * MIN, 'lastfeed')}
              />
            )}
            {lastWake != null && (
              <StripChip
                label={anchorLabel(ANCHOR_LABEL.woke, lastWake)}
                color={color}
                selected={startActive && te.startAnchor === 'wake'}
                onPress={() => setStartedAt(now - lastWake * MIN, 'wake')}
              />
            )}
            {lastDiaper != null && (
              <StripChip
                label={anchorLabel(ANCHOR_LABEL.diaper, lastDiaper)}
                color={color}
                selected={startActive && te.startAnchor === 'diaper'}
                onPress={() => setStartedAt(now - lastDiaper * MIN, 'diaper')}
              />
            )}
          </QuickSetStrip>
        </View>
      )}
```

- [ ] **Step 7: Rewrite the non-interval "When" panel (clock first, strip below)**

Replace the whole `{!isInterval && ( ... )}` block (currently lines 342-375) with:

```tsx
      {!isInterval && (
        <View style={{ gap: 10, marginBottom: 4 }}>
          <TimeAdjuster mode="clock" value={end} now={now} color={color} showRelative onChange={(ms) => setTE({ absTime: ms })} />
          <QuickSetStrip>
            <StripChip
              label="Now"
              color={color}
              selected={te.absTime == null && te.agoMin === 0}
              onPress={() => setTE({ agoMin: 0 })}
            />
            {lastFeed != null && (
              <StripChip label={ANCHOR_LABEL.feedEnded} color={color} onPress={() => setTE({ agoMin: lastFeed })} />
            )}
            {lastWake != null && (
              <StripChip label={ANCHOR_LABEL.woke} color={color} onPress={() => setTE({ agoMin: lastWake })} />
            )}
            {lastDiaper != null && (
              <StripChip label={ANCHOR_LABEL.diaper} color={color} onPress={() => setTE({ agoMin: lastDiaper })} />
            )}
          </QuickSetStrip>
        </View>
      )}
```

Do NOT touch the two "Lasted" blocks between the Start panel and the "When" panel (`{isInterval && !timerEdit && editing === 'lasted' && ...}` and `{isInterval && timerEdit && editing === 'lasted' && ...}`). They stay exactly as they are.

- [ ] **Step 8: Typecheck, lint, and run the full suite**

Run: `npx tsc --noEmit`
Expected: no errors. (Confirms `ComponentProps<typeof Chip>`, `ReactNode`, the `ScrollView` import, and the removed `fmtAgoShort` import all typecheck.)

Run: `npm run lint`
Expected: clean — in particular no "unused variable `fmtAgoShort`" warning.

Run: `npm test`
Expected: all tests green. No behavior changed, so `src/store/selectors.test.ts` and `src/store/useAppStore.test.ts` still pass; the Task 1 `format` tests pass.

- [ ] **Step 9: Functional verification on web**

Use the project's web-run recipe (see memory `budkin-run-on-web-verify`: Expo web + headless Playwright with `--no-sandbox`; run `npm install` first if `expo start` complains about a declared-but-uninstalled package). Prefer invoking the `/verify` or `/run` skill to drive it.

Open a running timer, tap it to open the edit sheet, and confirm:
- The exact clock editor (input + `−15m … +15m` steppers + day stepper) is the first thing under the readout pills, for both the Start pill and the End pill.
- Below it sits a `Quick set` label and a single-line row of chips. When more chips exist than fit, the row scrolls horizontally and the trailing chip peeks at the right edge.
- Chip labels read in the shortened form: `Now`, `Feed ended · 2h`, `Woke · 45m`, `Diaper · 1h`, `Feed started · 2h`, `Sleep started · 3h`, and `Still running`.
- Tapping each chip still sets the value as before (start anchors pin, `Now`/`Still running` behave, end anchors set the end), and the pinned end still shows on the save button.
- Open a regular (non-timer) interval log entry and a diaper ("When") entry and confirm the same clock-first order and strip there.

- [ ] **Step 10: Commit**

```bash
git add src/features/log/TimeEntry.tsx
git commit -m "feat(timers): lead time panels with the clock, anchors in a Quick set strip"
```

---

## Self-Review

**Spec coverage:**
- Clock-first order in each affected panel → Task 2 Steps 4-7.
- One-line horizontally-scrollable strip with edge-peek affordance, no new dep → Task 2 Step 2 (`QuickSetStrip` uses core `ScrollView`).
- Compact secondary chips → Task 2 Step 2 (`StripChip` sizing).
- Scope = four panels; two duration panels excluded → Task 2 Steps 4-7 plus the explicit "do not touch" note.
- Caption moved under the clock (timer-edit End) → Task 2 Step 5.
- Shortened labels centralized in pure, testable helpers → Task 1 (helpers + tests); consumed in Task 2 Steps 3-7.
- No behavior change; existing logic tests stay green → Task 2 Step 8.
- Functional web verification → Task 2 Step 9.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command lists expected output.

**Type consistency:** `ANCHOR_LABEL` / `anchorLabel(base, agoMin?)` defined in Task 1 are used with matching signatures in Task 2. `StripChip` uses `ComponentProps<typeof Chip>`; `QuickSetStrip` uses `ReactNode`; both imported in Step 1. `endAnchors` items keep the `{ min: number; label: string }` shape, so `anchorLabel(a.label, a.min)` and `key={a.label}` remain valid.
