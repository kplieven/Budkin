# Time-Entry Focused Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Time-Entry's three simultaneous chip rows with a single focused panel driven by the readout pills, cutting on-screen controls by ~two-thirds without slowing entry.

**Architecture:** The pills row (`Start → End · lasted`) becomes the always-visible summary and the selector: tapping a pill sets which quantity is *focused*, and only that quantity's panel (its kept chips + smart anchors + the precise `TimeAdjuster`) renders below. The interval selector/derived-field math in `selectors.ts` and every store action are untouched; this is a presentation-layer change in `TimeEntry.tsx` plus two small pure helpers and one opt-in prop on `TimeAdjuster`.

**Tech Stack:** Expo SDK 56 / React Native, TypeScript, Zustand store, Vitest (unit tests only, no component-test harness).

## Global Constraints

- **Expo SDK 56.** Read the versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing RN code. (from `AGENTS.md`)
- **No em-dashes** in UI copy, comments, or docs. Use commas, colons, or separate sentences.
- **Do not touch the store or selector math.** `DEFAULT_ORDER`, `derivedField`, `isActive`, `reorder`, `overruleLasted`, `teStart/teEnd/teDurationMin`, and all `useAppStore` actions stay exactly as they are. `src/store/selectors.test.ts` must stay green.
- **Tests run with** `npm test` (`vitest run`). There is **no React component test harness**, so component behavior is verified by typecheck + lint + manual run, not by a `.test.tsx` file.
- **Typecheck** with `npx tsc --noEmit`. **Lint** with `npm run lint` (`expo lint`).
- Path alias `@/` maps to `src/`.

---

### Task 1: `lastSleepStartMinAgo` selector

Mirror of the existing `lastWakeMinAgo` (last sleep *end*) but reading the sleep *start*, for the "ended when last sleep started" anchor. (`lastFeedStartMinAgo` already exists, so only the sleep one is new.)

**Files:**
- Modify: `src/store/selectors.ts` (add function after `lastWakeMinAgo`, around line 134)
- Test: `src/store/selectors.test.ts` (add to the existing `anchors` describe block, around line 88)

**Interfaces:**
- Produces: `lastSleepStartMinAgo(entries: Entry[], now: number): number | null` — whole minutes since the most recent completed sleep's `start`, or `null` when there is none.

- [ ] **Step 1: Add the failing test**

In `src/store/selectors.test.ts`, add `lastSleepStartMinAgo` to the import on line 3, then add this inside the `describe('anchors', ...)` block (its `entries` fixture already has a sleep with `start: NOW - 240 * M, end: NOW - 120 * M`):

```ts
it('lastSleepStartMinAgo counts from the sleep start, not the wake', () => {
  expect(lastSleepStartMinAgo(entries, NOW)).toBe(240);
  expect(lastSleepStartMinAgo([], NOW)).toBeNull();
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm test -- src/store/selectors.test.ts`
Expected: FAIL with `lastSleepStartMinAgo is not a function` (or an import/type error).

- [ ] **Step 3: Implement the selector**

In `src/store/selectors.ts`, directly after `lastWakeMinAgo` (ends ~line 134), add:

```ts
/** Minutes since the most recent completed sleep *started*, or null. */
export function lastSleepStartMinAgo(entries: Entry[], now: number): number | null {
  const s = entries
    .filter((e): e is Extract<Entry, { type: 'sleep' }> => e.type === 'sleep' && e.end != null)
    .sort((a, b) => b.start - a.start)[0];
  return s ? Math.round((now - s.start) / M) : null;
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm test -- src/store/selectors.test.ts`
Expected: PASS (all anchor tests green).

- [ ] **Step 5: Commit**

```bash
git add src/store/selectors.ts src/store/selectors.test.ts
git commit -m "feat(time-entry): lastSleepStartMinAgo selector for ended anchors"
```

---

### Task 2: `endAnchorVisible` predicate

A pure guard so an "ended when the next thing started" anchor is offered only when it can form a valid interval (after the current start, not in the future). Extracted as its own function specifically so it is unit-testable without a component harness.

**Files:**
- Modify: `src/store/selectors.ts` (add near the other anchor helpers)
- Test: `src/store/selectors.test.ts` (new describe block)

**Interfaces:**
- Produces: `endAnchorVisible(tMs: number, startMs: number, now: number): boolean` — `true` iff `startMs < tMs <= now`.

- [ ] **Step 1: Add the failing test**

Add `endAnchorVisible` to the import on line 3 of `src/store/selectors.test.ts`, then add a new describe block (place it after the `anchors` block):

```ts
describe('endAnchorVisible', () => {
  it('is visible when the anchor is after the start and not in the future', () => {
    expect(endAnchorVisible(NOW - 30 * M, NOW - 60 * M, NOW)).toBe(true);
  });
  it('is hidden when the anchor is at or before the start', () => {
    expect(endAnchorVisible(NOW - 60 * M, NOW - 60 * M, NOW)).toBe(false);
    expect(endAnchorVisible(NOW - 90 * M, NOW - 60 * M, NOW)).toBe(false);
  });
  it('is hidden when the anchor is in the future', () => {
    expect(endAnchorVisible(NOW + 5 * M, NOW - 60 * M, NOW)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm test -- src/store/selectors.test.ts`
Expected: FAIL with `endAnchorVisible is not a function`.

- [ ] **Step 3: Implement the predicate**

In `src/store/selectors.ts`, add near `lastDiaperMinAgo` (end of the anchor helpers, ~line 160):

```ts
/** Whether an "ended when the next activity started" anchor at `tMs` can form a
 *  valid interval: it must land after the current start and no later than now. */
export function endAnchorVisible(tMs: number, startMs: number, now: number): boolean {
  return tMs > startMs && tMs <= now;
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm test -- src/store/selectors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/selectors.ts src/store/selectors.test.ts
git commit -m "feat(time-entry): endAnchorVisible predicate for conditional ended anchors"
```

---

### Task 3: `TimeAdjuster` opt-in relative readout

Add a live "45m ago" label under the clock input. It is opt-in via a new prop so the two `TimeAdjuster` usages in `src/app/(tabs)/timers.tsx` are unaffected (they simply do not pass it).

**Files:**
- Modify: `src/components/TimeAdjuster.tsx`

**Interfaces:**
- Consumes: `fmtAgo(ms: number, now: number): string` from `@/lib/format` (already exists: `now` / `5m ago` / `1h 5m ago`).
- Produces: `TimeAdjuster` gains an optional prop `showRelative?: boolean` (default `false`). When `true` and `mode === 'clock'`, it renders `fmtAgo(value, now)` as a dim caption. No effect in duration mode.

- [ ] **Step 1: Add the prop to the interface**

In `src/components/TimeAdjuster.tsx`, add to `TimeAdjusterProps` (after `onChange`):

```ts
  /** clock mode only: show a live "45m ago" caption under the input */
  showRelative?: boolean;
```

- [ ] **Step 2: Destructure it and import `fmtAgo`**

Change the props destructure on the `TimeAdjuster` function signature to include `showRelative = false`:

```ts
export function TimeAdjuster({ mode, value, now, color, onChange, showRelative = false }: TimeAdjusterProps) {
```

Update the format import at the top of the file to add `fmtAgo`:

```ts
import { dayGroupLabel, fmtAgo, fmtClock, fmtDur } from '@/lib/format';
```

- [ ] **Step 3: Render the caption under the `TextInput`**

Immediately after the closing `/>` of the `<TextInput ... />` (before the `<View>` that holds the `STEPS` nudge buttons), add:

```tsx
      {showRelative && mode === 'clock' && (
        <Txt weight={600} size={12.5} color={t.dim} style={{ textAlign: 'center', marginTop: -2 }}>
          {fmtAgo(value, now)}
        </Txt>
      )}
```

- [ ] **Step 4: Typecheck and confirm no leak into the Timers tab**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `grep -n "TimeAdjuster" "src/app/(tabs)/timers.tsx"`
Expected: the two existing usages do NOT pass `showRelative` (so their behavior is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/components/TimeAdjuster.tsx
git commit -m "feat(time-entry): opt-in relative 'ago' caption on TimeAdjuster clock mode"
```

---

### Task 4: `TimeEntry` focused-panel restructure

Replace the three chip-row blocks with one focused panel. This is a single cohesive rewrite of the component's body (readout + panel renderer); it is one reviewer gate. No `.test.tsx` exists, so it is verified by typecheck, lint, existing unit tests, and a manual run.

**Files:**
- Modify (full rewrite of the component body): `src/features/log/TimeEntry.tsx`

**Interfaces:**
- Consumes: `lastSleepStartMinAgo`, `endAnchorVisible`, `lastFeedStartMinAgo` (Task 1/2 + existing) and `TimeAdjuster`'s `showRelative` (Task 3).
- Consumes (store, unchanged): `setTE`, `setEnded`, `setEndedAbs`, `setOngoing`, `setLasted`, `setTimerLasted`, `setStartedAt`, `derivedField`, `isActive`, `teStart`, `teEnd`, `teDurationMin`.
- Produces: no exported API change. `TimeEntry({ type, color })` keeps its signature.

**Key behavior decisions baked into the code below:**
- **Focusing a pill only reveals its panel; it does NOT pin the quantity.** Pinning happens on real interaction (chip / anchor / nudge / type) via the store setters. This is a deliberate refinement of the old `tap()` (which pinned on focus): it keeps a default `now` end live-relative instead of freezing it, and lets you focus the End pill while ongoing without silently ending the entry (since `setEndedAbs` clears `ongoing`).
- **Default focus:** `end` for a normal interval, `start` in timer-edit, `when` for a point entry. `editing` is never null.
- **Still ongoing** lives in the Ended panel; turning it on moves focus to Start. The End pill stays visible (labeled `now`) while ongoing so the Ended panel, and the toggle-off, stay reachable.
- **Started anchors** are ungated by type (feed ended / woke / diaper changed), matching the requested symmetric set. **Ended anchors** (feed started / sleep started / diaper changed) render only when `endAnchorVisible` holds.

- [ ] **Step 1: Replace the file contents**

Replace the entire contents of `src/features/log/TimeEntry.tsx` with:

```tsx
/**
 * The reusable Time-Entry component, the app's signature feature.
 *
 * One focused panel at a time. The readout pills (Start -> End, and Lasted) are
 * the always-visible summary AND the selector: tapping a pill focuses that
 * quantity and reveals its single panel (kept chips + smart anchors + the
 * precise editor); the other quantities' controls stay hidden. Three parallel
 * chip rows became one panel. The derived (computed) quantity is dimmed.
 * INTERVAL keeps the last two of Start/End/Lasted; POINT (diaper) is a single
 * "When" panel. Focusing a pill only reveals its panel, it does not pin: pinning
 * happens on a real chip/anchor/nudge/type interaction via the store setters.
 */

import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Chip } from '@/components/Chip';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { TimeAdjuster } from '@/components/TimeAdjuster';
import { Txt } from '@/components/Txt';
import { dayGroupLabel, fmtAgoShort, fmtClock, fmtDur, relDayLabel } from '@/lib/format';
import {
  derivedField,
  endAnchorVisible,
  isActive,
  lastDiaperMinAgo,
  lastFeedEndMinAgo,
  lastFeedStartMinAgo,
  lastSleepStartMinAgo,
  lastWakeMinAgo,
  teDurationMin,
  teEnd,
  teStart,
} from '@/store/selectors';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';
import type { ActivityType } from '@/types/models';

const MIN = 60000;

type EditField = 'start' | 'end' | 'lasted' | 'when';

/**
 * A tappable resolved value rendered as an inset pill (matches the chip
 * vocabulary). Fills with the activity color while focused; a derived quantity
 * is dimmed.
 */
function ValuePill({
  label,
  color,
  active,
  dimmed,
  onPress,
  big,
}: {
  label: string;
  color: string;
  active: boolean;
  dimmed?: boolean;
  onPress: () => void;
  big?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={(s) => [
        {
          paddingHorizontal: big ? 9 : 8,
          paddingVertical: big ? 4 : 2,
          borderRadius: 9,
          backgroundColor: active ? color : t.chip,
          borderWidth: 1.5,
          borderColor: active ? color : t.line2,
          cursor: 'pointer',
        },
        !active && isHovered(s) && { borderColor: t.dim },
      ]}
    >
      <Txt
        unselectable
        weight={800}
        size={big ? 17 : 12.5}
        tracking={big ? -0.3 : undefined}
        color={active ? t.onActivity : dimmed ? t.dim : t.text}
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {label}
      </Txt>
    </Pressable>
  );
}

export function TimeEntry({ type, color }: { type: ActivityType; color: string }) {
  const t = useTheme();
  const te = useAppStore((s) => s.te);
  const now = useAppStore((s) => s.now);
  const entries = useAppStore((s) => s.entries);
  // Editing a running timer (opened via openTimerEdit): a running timer has no
  // end/duration, so Ended does not apply. Only Start + Lasted (which stops and
  // logs it on save) are focusable. Gating on fromTimerId leaves normal
  // new-entry sheets untouched.
  const timerEdit = useAppStore((s) => s.fromTimerId != null);
  const setTE = useAppStore((s) => s.setTE);
  const setEnded = useAppStore((s) => s.setEnded);
  const setEndedAbs = useAppStore((s) => s.setEndedAbs);
  const setOngoing = useAppStore((s) => s.setOngoing);
  const setLasted = useAppStore((s) => s.setLasted);
  const setTimerLasted = useAppStore((s) => s.setTimerLasted);
  const setStartedAt = useAppStore((s) => s.setStartedAt);

  const isInterval = te.shape === 'interval';
  const [editing, setEditing] = useState<EditField>(
    !isInterval ? 'when' : timerEdit ? 'start' : 'end',
  );

  const start = teStart(te, now);
  const end = teEnd(te, now);
  const duration = teDurationMin(te, now);
  const derived = isInterval ? derivedField(te.order) : null;

  const endIsToday = new Date(end).toDateString() === new Date(now).toDateString();
  const resultSub = isInterval ? `running · ${fmtDur(duration)} so far` : relDayLabel(end, now);

  const lastFeed = lastFeedEndMinAgo(entries, now);
  const lastWake = lastWakeMinAgo(entries, now);
  const lastDiaper = lastDiaperMinAgo(entries, now);
  const feedStart = lastFeedStartMinAgo(entries, now);
  const sleepStart = lastSleepStartMinAgo(entries, now);

  const endActive = isActive(te.order, 'end');
  const startActive = isActive(te.order, 'start');

  // Focus only reveals a panel; the store setters do the pinning on interaction.
  const focus = (f: EditField) => setEditing(f);

  // Turning on "Still ongoing" makes End live ("now") and Lasted "running",
  // neither editable, so move focus to Start (the only editable quantity).
  const goOngoing = () => {
    setOngoing();
    setEditing('start');
  };

  // Ended anchors: "this ended when the next thing started". Keep only those
  // that land after the current start (and not in the future).
  const endAnchors = (
    isInterval
      ? [
          feedStart != null ? { min: feedStart, label: 'When last feed started' } : null,
          sleepStart != null ? { min: sleepStart, label: 'When last sleep started' } : null,
          lastDiaper != null ? { min: lastDiaper, label: 'When last diaper changed' } : null,
        ]
      : []
  ).filter(
    (a): a is { min: number; label: string } =>
      a != null && endAnchorVisible(now - a.min * MIN, start as number, now),
  );

  return (
    <View style={{ backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, borderRadius: 20, padding: 16, marginBottom: 16 }}>
      {/* readout: pills are the summary AND the selector */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 13 }}>
        <Icon name="clock" color={color} size={18} />
        <View style={{ flex: 1, gap: 5 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            {isInterval ? (
              <>
                <ValuePill big label={fmtClock(start as number)} color={color} active={editing === 'start'} dimmed={derived === 'start'} onPress={() => focus('start')} />
                <Txt weight={700} size={16} color={t.dim}>
                  →
                </Txt>
                {timerEdit ? (
                  <Txt weight={800} size={17} tracking={-0.3} color={t.dim}>
                    {te.ongoing ? 'now' : fmtClock(end)}
                  </Txt>
                ) : te.ongoing ? (
                  <ValuePill big label="now" color={color} active={editing === 'end'} onPress={() => focus('end')} />
                ) : (
                  <ValuePill big label={fmtClock(end)} color={color} active={editing === 'end'} dimmed={derived === 'end'} onPress={() => focus('end')} />
                )}
              </>
            ) : (
              <ValuePill big label={fmtClock(end)} color={color} active={editing === 'when'} onPress={() => focus('when')} />
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {isInterval && !te.ongoing ? (
              <>
                {!endIsToday && (
                  <Txt weight={500} size={12.5} color={t.dim}>
                    {dayGroupLabel(end, now)} ·
                  </Txt>
                )}
                <Txt weight={500} size={12.5} color={t.dim}>
                  lasted
                </Txt>
                <ValuePill label={fmtDur(duration)} color={color} active={editing === 'lasted'} dimmed={derived === 'lasted'} onPress={() => focus('lasted')} />
              </>
            ) : isInterval && te.ongoing && timerEdit ? (
              <>
                <Txt weight={500} size={12.5} color={t.dim}>
                  running ·
                </Txt>
                <ValuePill label={fmtDur(duration)} color={color} active={editing === 'lasted'} onPress={() => focus('lasted')} />
              </>
            ) : (
              <Txt weight={500} size={12.5} color={t.dim}>
                {resultSub}
              </Txt>
            )}
          </View>
        </View>
      </View>

      {/* one focused panel */}
      {isInterval && !timerEdit && editing === 'end' && (
        <View style={{ gap: 10, marginBottom: 4 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip
              label="Now"
              color={color}
              selected={!te.ongoing && endActive && te.endAbs == null && te.endAgoMin === 0}
              onPress={() => setEnded(0)}
            />
            <Chip label="Still ongoing" color={color} selected={!!te.ongoing} onPress={goOngoing} />
            {endAnchors.map((a) => (
              <Chip
                key={a.label}
                label={`${a.label} (${fmtAgoShort(a.min)})`}
                color={color}
                selected={!te.ongoing && endActive && te.endAbs === now - a.min * MIN}
                onPress={() => setEndedAbs(now - a.min * MIN)}
              />
            ))}
          </View>
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
        </View>
      )}

      {isInterval && editing === 'start' && (
        <View style={{ gap: 10, marginBottom: 4 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip
              label="Now"
              color={color}
              selected={startActive && te.startAnchor === 'now'}
              onPress={() => setStartedAt(now, 'now')}
            />
            {lastFeed != null && (
              <Chip
                label={`When last feed ended (${fmtAgoShort(lastFeed)})`}
                color={color}
                selected={startActive && te.startAnchor === 'lastfeed'}
                onPress={() => setStartedAt(now - lastFeed * MIN, 'lastfeed')}
              />
            )}
            {lastWake != null && (
              <Chip
                label={`When they woke (${fmtAgoShort(lastWake)})`}
                color={color}
                selected={startActive && te.startAnchor === 'wake'}
                onPress={() => setStartedAt(now - lastWake * MIN, 'wake')}
              />
            )}
            {lastDiaper != null && (
              <Chip
                label={`When last diaper changed (${fmtAgoShort(lastDiaper)})`}
                color={color}
                selected={startActive && te.startAnchor === 'diaper'}
                onPress={() => setStartedAt(now - lastDiaper * MIN, 'diaper')}
              />
            )}
          </View>
          <TimeAdjuster
            mode="clock"
            value={start as number}
            now={now}
            color={color}
            showRelative
            onChange={(ms) => setStartedAt(te.ongoing ? ms : Math.min(ms, end))}
          />
        </View>
      )}

      {isInterval && !timerEdit && editing === 'lasted' && (
        <TimeAdjuster mode="duration" value={Math.max(1, duration)} now={now} color={color} onChange={setLasted} />
      )}

      {isInterval && timerEdit && editing === 'lasted' && (
        <View style={{ gap: 10, marginBottom: 4 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip label="Still running" color={color} selected={!!te.ongoing} onPress={setOngoing} />
          </View>
          <Txt weight={500} size={12} color={t.dim}>
            {te.ongoing ? 'Pick a length to stop the timer and log it.' : 'Saving stops the timer and logs it.'}
          </Txt>
          <TimeAdjuster mode="duration" value={Math.max(1, duration)} now={now} color={color} onChange={setTimerLasted} />
        </View>
      )}

      {!isInterval && (
        <View style={{ gap: 10, marginBottom: 4 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip
              label="Now"
              color={color}
              selected={te.absTime == null && te.agoMin === 0}
              onPress={() => setTE({ agoMin: 0 })}
            />
            {lastFeed != null && (
              <Chip
                label="When last feed ended"
                color={color}
                selected={te.absTime == null && te.agoMin === lastFeed}
                onPress={() => setTE({ agoMin: lastFeed, absTime: undefined })}
              />
            )}
            {lastWake != null && (
              <Chip
                label="When they woke"
                color={color}
                selected={te.absTime == null && te.agoMin === lastWake}
                onPress={() => setTE({ agoMin: lastWake, absTime: undefined })}
              />
            )}
            {lastDiaper != null && (
              <Chip
                label="When last diaper changed"
                color={color}
                selected={te.absTime == null && te.agoMin === lastDiaper}
                onPress={() => setTE({ agoMin: lastDiaper, absTime: undefined })}
              />
            )}
          </View>
          <TimeAdjuster mode="clock" value={end} now={now} color={color} showRelative onChange={(ms) => setTE({ absTime: ms })} />
        </View>
      )}
    </View>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If `teStart` complains about `number | null`, the `start as number` casts in the interval branches cover it, matching the original file.)

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors, and no "unused variable" warnings (the old `SubLabel`, `ENDED_OPTS`, `AGO_OPTS`, `STARTED_OPTS`, `lastedOpts`, `setStartedAgo`, and `lastedActive` are all gone).

- [ ] **Step 4: Run the full unit suite (regression guard)**

Run: `npm test`
Expected: PASS. The selector/store math is untouched, so `selectors.test.ts` and all timer tests stay green.

- [ ] **Step 5: Manual verification (run the app)**

Use the `/run` skill (or `npx expo start`) and open the log sheets. Verify:
1. **New feed (interval):** opens with the **Ended** panel focused (End pill filled), showing `Now` + `Still ongoing` + any valid ended anchors + the clock editor with a live "ago" caption. Only ONE panel is visible (no three stacked rows).
2. **Switch focus:** tapping the **Start** pill hides the Ended panel and shows the Started panel (Now + feed-ended / woke / diaper anchors + editor). Tapping the **lasted** pill shows the duration editor (nudges + input, no preset chips).
3. **Relative caption:** in the Started or Ended panel, tapping `−15` three times from a "now" value shows "45m ago" under the input.
4. **Still ongoing:** in the Ended panel tap `Still ongoing`; focus jumps to Start, the End pill reads `now`, the second line reads "running ... so far". Tapping the `now` End pill reopens the Ended panel; tapping `Now` there turns ongoing back off and the lasted pill returns.
5. **Ended anchor validity:** with a start pinned earlier than the last feed's start, the "When last feed started" ended-anchor appears; pin a start later than it and the anchor disappears.
6. **Diaper (point):** shows the single "When" panel (Now + anchors + editor), no focus switching.
7. **Timer edit** (open a running timer from the Timers tab): opens on the **Start** panel, End shows as plain `now` text (no Ended panel reachable), the lasted pill opens the "Still running" + "stop and log" note + duration editor.

- [ ] **Step 6: Commit**

```bash
git add src/features/log/TimeEntry.tsx
git commit -m "feat(time-entry): one focused panel instead of three chip rows"
```

---

## Self-Review

**Spec coverage:**
- One focused panel, pills as selector, derived dimmed → Task 4 readout + panel renderer. ✓
- All fixed presets stripped, keep Now / Still ongoing / smart anchors → Task 4 panels. ✓
- Relative "ago" readout on clock panels → Task 3 (`showRelative`) wired in Task 4. ✓
- Symmetric anchors; new `lastSleepStartMinAgo` (feed-start already existed) → Task 1 + Task 4. ✓
- Ended anchors conditional on `start < t <= now` → Task 2 predicate + Task 4 `endAnchors`. ✓
- Default focus Ended (interval) / Started (timer-edit); point single panel → Task 4 initial `editing`. ✓
- Still ongoing reachability + auto-focus to Start → Task 4 `goOngoing` + End pill stays visible while ongoing. ✓
- Timer-edit variant keeps note + Still running, no Ended → Task 4 timer branches. ✓
- Store / selector math untouched, existing tests green → Global Constraints + Task 4 Step 4. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step has an expected result. ✓

**Type consistency:** `lastSleepStartMinAgo(entries, now)` and `endAnchorVisible(tMs, startMs, now)` are defined in Tasks 1/2 and consumed with those exact signatures in Task 4. `showRelative` prop defined in Task 3, passed in Task 4. `EditField` is `'start' | 'end' | 'lasted' | 'when'` and `editing` is never null. ✓

**Deviation note:** Task 4 intentionally drops the old "focus pins the quantity" behavior (focus now only reveals a panel; setters pin on interaction). Rationale is documented in Task 4's key-decisions block: it keeps a default `now` end live and makes the ongoing End pill safe to focus. Visible UX from the approved spec is unchanged.
