# Onboarding Setup Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the passive five-slide first run with a branching setup wizard that asks where the user's data lives and who they are tracking, ending on a Home that is never empty without a way forward.

**Architecture:** Three routes chained with `expo-router` pushes (`/welcome` asks the server question, the existing `/onboarding` handles connecting, a new `/setup/baby` collects the child), plus a `/tour` route that inherits the old carousel for Settings. All branching logic that can be tested without a renderer is extracted into pure functions under `src/features/setup/` and `src/lib/`, because this repo has no component test setup.

**Tech Stack:** Expo SDK 56, expo-router 56, React 19, React Native 0.85, zustand store (`src/store/useAppStore.ts`), vitest for unit tests.

## Global Constraints

- **Expo version:** SDK 56. Read the versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any Expo API code (per `AGENTS.md`).
- **No em-dashes** in any prose, comment, or UI copy. Use commas, colons, or separate sentences.
- **zustand v5 selectors:** never return a fresh reference from a `useAppStore` selector. No inline `.filter`/`.map`/object literals. Select raw values or primitives and derive in render, or web routes blank-screen with "Maximum update depth exceeded".
- **Tests:** `npx vitest run` for unit tests. There is no component test infrastructure, only vitest over `src/lib`, `src/data`, and `src/store`. Route components are verified by the end-to-end web run in Task 7.
- **Typecheck:** `npx tsc --noEmit`. **Lint:** `npm run lint`.
- **Path alias:** `@/` maps to `src/`.
- **Branch:** work continues on `onboarding-setup-wizard`, which already holds the spec commit.

---

### Task 1: Extract `clampBirth` into a shared module

The setup form and the existing child sheet both need to turn three numeric text fields into a valid, non-future epoch-ms birth date. It currently lives as a private function inside `ChildSheet.tsx`. Extract it so there is one implementation, and get it under test while it moves.

**Files:**
- Create: `src/lib/birthDate.ts`
- Create: `src/lib/birthDate.test.ts`
- Modify: `src/features/childSwitcher/ChildSheet.tsx:19-36` (delete the local `midnight` and `clampBirth`, import instead)

**Interfaces:**
- Consumes: nothing.
- Produces: `midnight(): number` and `clampBirth(yStr: string, mStr: string, dStr: string): number` from `@/lib/birthDate`. Task 4 uses `clampBirth`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/birthDate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { clampBirth, midnight } from '@/lib/birthDate';

describe('midnight', () => {
  it('returns local midnight today', () => {
    const d = new Date(midnight());
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
    expect(d.toDateString()).toBe(new Date().toDateString());
  });
});

describe('clampBirth', () => {
  it('converts a valid past date to local midnight', () => {
    expect(clampBirth('2024', '3', '15')).toBe(new Date(2024, 2, 15).getTime());
  });

  it('never returns a date in the future', () => {
    const thisYear = String(new Date().getFullYear());
    expect(clampBirth(thisYear, '12', '31')).toBe(midnight());
  });

  it('clamps the year to the current year', () => {
    expect(clampBirth('2999', '1', '1')).toBe(new Date(new Date().getFullYear(), 0, 1).getTime());
  });

  it('clamps the year up to 1900', () => {
    expect(clampBirth('1800', '5', '4')).toBe(new Date(1900, 4, 4).getTime());
  });

  it('clamps the day to the days in that month, honouring leap years', () => {
    expect(clampBirth('2024', '2', '30')).toBe(new Date(2024, 1, 29).getTime());
    expect(clampBirth('2023', '2', '30')).toBe(new Date(2023, 1, 28).getTime());
  });

  it('clamps an out-of-range month into 1-12', () => {
    expect(clampBirth('2020', '13', '9')).toBe(new Date(2020, 11, 9).getTime());
    expect(clampBirth('2020', '0', '9')).toBe(new Date(2020, 0, 9).getTime());
  });

  it('falls back to 1 January of the current year on unparseable input', () => {
    expect(clampBirth('', 'abc', '')).toBe(new Date(new Date().getFullYear(), 0, 1).getTime());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/birthDate.test.ts`
Expected: FAIL, cannot resolve the module `@/lib/birthDate`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/birthDate.ts`:

```ts
/** Local midnight today, epoch ms. The ceiling for any birth date. */
export function midnight(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Clamp raw Y/M/D text fields to a valid, non-future local date and convert
 *  to epoch ms (local midnight). No date-picker dependency, just numeric
 *  TextInputs validated on save. Shared by the child sheet and the first-run
 *  setup form so both accept exactly the same input. */
export function clampBirth(yStr: string, mStr: string, dStr: string): number {
  const now = new Date();
  const y = Math.min(now.getFullYear(), Math.max(1900, parseInt(yStr, 10) || now.getFullYear()));
  const mo = Math.min(12, Math.max(1, parseInt(mStr, 10) || 1));
  const maxDay = new Date(y, mo, 0).getDate(); // days in month `mo` (1-12)
  const d = Math.min(maxDay, Math.max(1, parseInt(dStr, 10) || 1));
  return Math.min(new Date(y, mo - 1, d).getTime(), midnight());
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/birthDate.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Point `ChildSheet` at the shared module**

In `src/features/childSwitcher/ChildSheet.tsx`, delete the local `midnight` function (currently lines 20-24) and the local `clampBirth` function (currently lines 26-36) entirely. Add to the import block, in alphabetical position among the `@/` imports:

```ts
import { clampBirth } from '@/lib/birthDate';
```

Leave the `REMOVE_COLOR` constant and everything else alone. `ChildSheet` does not call `midnight` directly, so only `clampBirth` is imported.

- [ ] **Step 6: Verify nothing else referenced the old locals**

Run: `grep -n "midnight\|clampBirth" src/features/childSwitcher/ChildSheet.tsx`
Expected: exactly two lines, the new import and the call inside `onSave`.

- [ ] **Step 7: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/birthDate.ts src/lib/birthDate.test.ts src/features/childSwitcher/ChildSheet.tsx
git commit -m "refactor(child): extract clampBirth into a tested shared module"
```

---

### Task 2: The post-connect routing decision

The connect step needs to know whether to finish or continue into the add-baby step. That decision is the one piece of the server branch that can be tested without a renderer, so it becomes a pure function.

**Files:**
- Create: `src/features/setup/routing.ts`
- Create: `src/features/setup/routing.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `nextAfterConnect(childCount: number): '/setup/baby' | '/(tabs)'` from `@/features/setup/routing`. Task 5 calls it.

- [ ] **Step 1: Write the failing test**

Create `src/features/setup/routing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { nextAfterConnect } from '@/features/setup/routing';

describe('nextAfterConnect', () => {
  it('continues into the add-baby step when the server has no children', () => {
    expect(nextAfterConnect(0)).toBe('/setup/baby');
  });

  it('finishes straight into the app when the server already has a child', () => {
    expect(nextAfterConnect(1)).toBe('/(tabs)');
  });

  it('finishes straight into the app for several children', () => {
    expect(nextAfterConnect(4)).toBe('/(tabs)');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/setup/routing.test.ts`
Expected: FAIL, cannot resolve the module `@/features/setup/routing`.

- [ ] **Step 3: Write the implementation**

Create `src/features/setup/routing.ts`:

```ts
/** Where the connect step goes once a server connection succeeds. A server with
 *  no children on it yet (a fresh Baby Buddy install) continues into the
 *  add-baby step rather than dead-ending the user on an empty Home. */
export function nextAfterConnect(childCount: number): '/setup/baby' | '/(tabs)' {
  return childCount === 0 ? '/setup/baby' : '/(tabs)';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/setup/routing.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/setup/routing.ts src/features/setup/routing.test.ts
git commit -m "feat(setup): post-connect routing decision"
```

---

### Task 3: Shared setup furniture and the `/tour` route

Three things the wizard's screens all need. Every exit does the same two things (mark the tutorial seen so Home's gate stops redirecting back into setup, then replace into the app), so that goes in one hook. Both wizard screens use the same pair of buttons, so those become one component rather than a style block copied twice. And the old carousel becomes a Settings-only tour, which frees `/welcome` for Task 4 to rewrite.

**Files:**
- Create: `src/features/setup/useFinishSetup.ts`
- Create: `src/features/setup/SetupButton.tsx`
- Create: `src/app/tour.tsx`
- Modify: `src/app/settings.tsx:259` and `:264`

**Interfaces:**
- Consumes: nothing.
- Produces: `useFinishSetup(): () => void` from `@/features/setup/useFinishSetup`, and `SetupButton` from `@/features/setup/SetupButton` with props `{ label: string; onPress: () => void; variant?: 'primary' | 'secondary'; disabled?: boolean; style?: ViewStyle }`. Tasks 4 and 5 use both.

- [ ] **Step 1: Write the finish hook**

Create `src/features/setup/useFinishSetup.ts`:

```ts
import { router } from 'expo-router';
import { useCallback } from 'react';

import { useAppStore } from '@/store/useAppStore';

/**
 * Ends the first-run setup flow. Marking the tutorial seen has to happen before
 * the navigation: Home redirects back to `/welcome` while `tutorialSeen` is
 * false (see src/app/(tabs)/index.tsx), so replacing first would bounce the
 * user straight back into setup. Every branch of the wizard exits through here.
 *
 * Memoized because callers put it in effect dependency arrays: an unmemoized
 * closure would re-fire those effects on every render of the calling screen.
 */
export function useFinishSetup(): () => void {
  const completeTutorial = useAppStore((s) => s.completeTutorial);
  return useCallback(() => {
    completeTutorial();
    router.replace('/(tabs)');
  }, [completeTutorial]);
}
```

The `useCallback` is load-bearing, not decoration: Task 6 puts `finish` in a `useEffect` dependency array, and an unmemoized closure would re-fire that effect on every render of the connect screen.

- [ ] **Step 2: Create the shared setup button**

Both wizard screens need the same filled primary action and the same outlined alternative beneath it. One component keeps the two steps visually locked together.

Create `src/features/setup/SetupButton.tsx`:

```tsx
import { Pressable, type ViewStyle } from 'react-native';

import { isHovered } from '@/components/hover';
import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { shadowStyle } from '@/theme/shadow';
import { useTheme } from '@/theme/useTheme';

/**
 * The setup wizard's button. Primary is the filled, shadowed call to action,
 * secondary the outlined alternative that sits beneath it. Both wizard screens
 * use this so the steps stay visually identical, and a disabled primary keeps
 * its shape while dropping the shadow and the pointer cursor.
 */
export function SetupButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const t = useTheme();
  const primary = variant === 'primary';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={(s) => [
        {
          height: 56,
          borderRadius: 17,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: primary ? t.primary : t.surface,
          borderWidth: primary ? 0 : 1.5,
          borderColor: t.line2,
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'auto' : 'pointer',
        },
        primary && !disabled && shadowStyle(`0px 8px 22px ${hexA(t.primary, 0.35)}`),
        !disabled && isHovered(s) && (primary ? { opacity: 0.9 } : { borderColor: t.line }),
        style,
      ]}
    >
      <Txt
        unselectable
        weight={primary ? 800 : 700}
        size={primary ? 17 : 16}
        color={primary ? t.onPrimary : t.text}
      >
        {label}
      </Txt>
    </Pressable>
  );
}
```

- [ ] **Step 3: Create the tour route**

Create `src/app/tour.tsx`:

```tsx
import { router } from 'expo-router';

import { Walkthrough } from '@/features/walkthrough/Walkthrough';

/**
 * The feature tour, reachable from Settings > Help. First run is a setup wizard
 * now (src/app/welcome.tsx), so this route only ever opens from inside the app
 * and dismissing returns the way the user came. It deliberately does not touch
 * `tutorialSeen`: the setup flow owns that flag.
 */
export default function Tour() {
  return <Walkthrough onDone={() => router.back()} />;
}
```

- [ ] **Step 4: Point the Settings Help row at the tour**

In `src/app/settings.tsx`, replace the row's `onPress` (currently line 259):

```tsx
          onPress={() => router.push({ pathname: '/welcome', params: { replay: '1' } })}
```

with:

```tsx
          onPress={() => router.push('/tour')}
```

and its label (currently line 264):

```tsx
            Show the walkthrough
```

with:

```tsx
            How Budkin works
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`

Expected: **errors on the `/tour` href only**, of the form "Type '"/tour"' is not assignable". This is expected and is not yours to fix. expo-router's typed routes are enumerated in `.expo/types/router.d.ts`, a gitignored build artifact that only regenerates when the dev server runs, and you must not start the dev server. Report the failure in your report file, naming the offending line, and confirm there are no *other* type errors. The controller regenerates the route types and re-runs the check before review.

- [ ] **Step 6: Commit**

```bash
git add src/features/setup/useFinishSetup.ts src/features/setup/SetupButton.tsx src/app/tour.tsx src/app/settings.tsx
git commit -m "feat(setup): finish hook, shared setup button, /tour route"
```

---

### Task 4: The welcome screen asks the server question

`/welcome` stops being a carousel and becomes step one: a short welcome, then the question that forks the flow. "Yes" pushes the existing connect form. "Just this device" enters local mode first, so the add-baby step that follows has somewhere to persist, then pushes the baby step.

**Files:**
- Modify: `src/app/welcome.tsx` (full rewrite, 25 lines to roughly 110)

**Interfaces:**
- Consumes: `enterLocal` from the store.
- Produces: navigation into `/onboarding` and `/setup/baby`. No exports beyond the default route component.

- [ ] **Step 1: Rewrite the route**

Replace the entire contents of `src/app/welcome.tsx` with:

```tsx
import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { SetupButton } from '@/features/setup/SetupButton';
import { hexA } from '@/lib/color';
import { shadowStyle } from '@/theme/shadow';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

/**
 * First-run step 1: a short welcome, then the one question that forks setup.
 * "Yes" continues to the existing connect form. "Just this device" enters local
 * mode before navigating, so the add-baby step that follows has a live local
 * connection to persist into. The feature tour that used to live here moved to
 * /tour (Settings > Help).
 */
export default function Welcome() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const enterLocal = useAppStore((s) => s.enterLocal);

  const goLocal = async () => {
    await enterLocal();
    router.push('/setup/baby');
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{
        flexGrow: 1,
        paddingTop: insets.top + 32,
        paddingHorizontal: 24,
        paddingBottom: insets.bottom + 24,
      }}
    >
      <View
        style={[
          {
            width: 60,
            height: 60,
            borderRadius: 19,
            backgroundColor: t.primary,
            alignItems: 'center',
            justifyContent: 'center',
          },
          shadowStyle(`0px 8px 24px ${hexA(t.primary, 0.4)}`),
        ]}
      >
        <Icon name="heart" color={t.onPrimary} size={30} />
      </View>

      <Txt weight={800} size={28} tracking={-0.6} style={{ marginTop: 22, lineHeight: 34 }}>
        Welcome to Budkin
      </Txt>
      <Txt weight={500} size={15} color={t.dim} style={{ marginTop: 10, lineHeight: 22 }}>
        A calm, fast way to track your baby&apos;s day, from feeds and naps to the milestones in
        between.
      </Txt>

      <View style={{ flex: 1, minHeight: 32 }} />

      <Txt weight={700} size={18} tracking={-0.3} style={{ marginBottom: 8 }}>
        Do you have a Baby Buddy server?
      </Txt>
      <Txt weight={500} size={14} color={t.dim} style={{ marginBottom: 20, lineHeight: 21 }}>
        Baby Buddy is a tracker you host yourself. Connecting one syncs your data across devices.
        Without one, Budkin keeps everything on this device and you can connect later.
      </Txt>

      <SetupButton label="Yes, I have a server" onPress={() => router.push('/onboarding')} />
      <SetupButton
        label="Just use this device"
        variant="secondary"
        onPress={goLocal}
        style={{ marginTop: 12 }}
      />
    </ScrollView>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

Expected: **errors on the `/setup/baby` href only**, of the form "Type '"/setup/baby"' is not assignable". Expected and not yours to fix, for the same reason as Task 3: expo-router's typed routes live in `.expo/types/router.d.ts`, a gitignored artifact that only regenerates when the dev server runs, and you must not start the dev server. Report the failure naming the offending line, and confirm there are no *other* type errors. The controller regenerates and re-checks before review.

- [ ] **Step 3: Commit**

```bash
git add src/app/welcome.tsx
git commit -m "feat(setup): welcome screen asks the server question"
```

---

### Task 5: The add-baby step

One route holding a three-way internal step: the born-or-not question, the child form, and the expecting acknowledgement. Back steps within the fork rather than leaving the route, so the user can change their answer without losing the branch they came from.

**Files:**
- Create: `src/app/setup/baby.tsx`

**Interfaces:**
- Consumes: `clampBirth` from `@/lib/birthDate` (Task 1), `useFinishSetup` from `@/features/setup/useFinishSetup` (Task 3), `saveChild` from the store.
- Produces: the `/setup/baby` route referenced by Tasks 4 and 6.

Note on `saveChild`: it branches on the store's `editingChildId`, which is null outside the child sheet, so calling it here always creates. On create it assigns a local id, auto-selects the new child, and pushes it to the server when the connection is a live server one (`src/store/useAppStore.ts:1088`). That is why both the local branch and the empty-server branch call the same action with no special casing.

- [ ] **Step 1: Create the route**

Create `src/app/setup/baby.tsx`:

```tsx
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { SetupButton } from '@/features/setup/SetupButton';
import { useFinishSetup } from '@/features/setup/useFinishSetup';
import { clampBirth } from '@/lib/birthDate';
import { fontFamily } from '@/theme/fonts';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

type Step = 'ask' | 'form' | 'expecting';

/**
 * First-run step 2: who are we tracking. Reached from the welcome screen in the
 * local branch, and from the connect form when a server turns out to have no
 * children on it yet. Both cases create the child through the store's saveChild,
 * which handles the server push itself when connected.
 *
 * An expecting parent gets an acknowledgement and no child record: a Child needs
 * a birth date, and a future one would feed negative ages into the age strings,
 * milestones, growth, and the server sync. Adding the baby once born is a tap
 * from Home's empty state. A richer expecting state is specced separately.
 */
export default function SetupBaby() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const finish = useFinishSetup();
  const saveChild = useAppStore((s) => s.saveChild);

  const [step, setStep] = useState<Step>('ask');
  const today = new Date();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [year, setYear] = useState(String(today.getFullYear()));
  const [month, setMonth] = useState(String(today.getMonth() + 1));
  const [day, setDay] = useState(String(today.getDate()));

  const canSave = first.trim().length > 0;

  const onAdd = () => {
    if (!canSave) return;
    saveChild({ first: first.trim(), last: last.trim(), birth: clampBirth(year, month, day) });
    finish();
  };

  // Back leaves the fork before it leaves the route, so changing the answer
  // does not drop the user back to the branch they arrived from.
  const onBack = () => {
    if (step === 'ask') router.back();
    else setStep('ask');
  };

  const input = {
    height: 54,
    borderRadius: 15,
    backgroundColor: t.surface,
    borderWidth: 1.5,
    borderColor: t.line2,
    paddingHorizontal: 16,
    fontSize: 15.5,
    fontFamily: fontFamily(500),
    color: t.text,
  } as const;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{
        flexGrow: 1,
        paddingTop: insets.top + 16,
        paddingHorizontal: 24,
        paddingBottom: insets.bottom + 24,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={10}
        style={(s) => [
          { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginLeft: -8, cursor: 'pointer' },
          isHovered(s) && { backgroundColor: t.chip },
        ]}
      >
        <Icon name="chevron-left" color={t.text} size={22} />
      </Pressable>

      {step === 'ask' && (
        <>
          <View style={{ flex: 1, minHeight: 24 }} />
          <Txt weight={800} size={26} tracking={-0.5} style={{ lineHeight: 32 }}>
            Has your baby arrived?
          </Txt>
          <Txt weight={500} size={15} color={t.dim} style={{ marginTop: 10, marginBottom: 24, lineHeight: 22 }}>
            Budkin tracks feeds, naps, nappies and growth from day one.
          </Txt>

          <SetupButton label="Yes, they are here" onPress={() => setStep('form')} />
          <SetupButton
            label="Not yet"
            variant="secondary"
            onPress={() => setStep('expecting')}
            style={{ marginTop: 12 }}
          />
        </>
      )}

      {step === 'form' && (
        <>
          <Txt weight={800} size={26} tracking={-0.5} style={{ marginTop: 12, lineHeight: 32 }}>
            Add your baby
          </Txt>
          <Txt weight={500} size={15} color={t.dim} style={{ marginTop: 10, lineHeight: 22 }}>
            Just a name and a birthday. Everything else can wait.
          </Txt>

          <View style={{ marginTop: 24 }}>
            <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 8 }}>
              FIRST NAME
            </Txt>
            <TextInput
              value={first}
              onChangeText={setFirst}
              placeholder="Rowan"
              placeholderTextColor={t.faint}
              autoCapitalize="words"
              autoCorrect={false}
              style={input}
            />
          </View>

          <View style={{ marginTop: 16 }}>
            <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 8 }}>
              LAST NAME (OPTIONAL)
            </Txt>
            <TextInput
              value={last}
              onChangeText={setLast}
              placeholder="Optional"
              placeholderTextColor={t.faint}
              autoCapitalize="words"
              autoCorrect={false}
              style={input}
            />
          </View>

          <View style={{ marginTop: 16 }}>
            <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 8 }}>
              BIRTHDAY
            </Txt>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TextInput
                value={day}
                onChangeText={setDay}
                placeholder="DD"
                placeholderTextColor={t.faint}
                keyboardType="number-pad"
                maxLength={2}
                style={[input, { flex: 1, textAlign: 'center' }]}
              />
              <TextInput
                value={month}
                onChangeText={setMonth}
                placeholder="MM"
                placeholderTextColor={t.faint}
                keyboardType="number-pad"
                maxLength={2}
                style={[input, { flex: 1, textAlign: 'center' }]}
              />
              <TextInput
                value={year}
                onChangeText={setYear}
                placeholder="YYYY"
                placeholderTextColor={t.faint}
                keyboardType="number-pad"
                maxLength={4}
                style={[input, { flex: 1.4, textAlign: 'center' }]}
              />
            </View>
          </View>

          <View style={{ flex: 1, minHeight: 24 }} />

          <SetupButton
            label="Add baby"
            onPress={onAdd}
            disabled={!canSave}
            style={{ marginTop: 24 }}
          />

          <Pressable
            onPress={finish}
            accessibilityRole="button"
            style={(s) => [{ marginTop: 18, alignItems: 'center', cursor: 'pointer' }, isHovered(s) && { opacity: 0.75 }]}
          >
            <Txt unselectable weight={600} size={13.5} color={t.dim}>
              Skip for now
            </Txt>
          </Pressable>
        </>
      )}

      {step === 'expecting' && (
        <>
          <View style={{ flex: 1, minHeight: 24 }} />
          <Txt weight={800} size={26} tracking={-0.5} style={{ lineHeight: 32 }}>
            We will be ready when they are
          </Txt>
          <Txt weight={500} size={15} color={t.dim} style={{ marginTop: 12, lineHeight: 22 }}>
            Have a look around in the meantime. When your baby arrives, add them from the button on
            your home screen and everything starts from there.
          </Txt>

          <View style={{ flex: 1, minHeight: 24 }} />

          <SetupButton label="Got it" onPress={finish} style={{ marginTop: 24 }} />
        </>
      )}
    </ScrollView>
  );
}
```

- [ ] **Step 2: Lint, and typecheck with the known caveat**

Run: `npm run lint`
Expected: clean on the new file.

Run: `npx tsc --noEmit`

Expected: **errors on the `/setup/baby` href only** (raised from `src/app/welcome.tsx`, Task 4). Creating the route file does not fix this by itself: the href union lives in `.expo/types/router.d.ts`, which only regenerates when the dev server runs, and you must not start the dev server. Report the failure and confirm there are no *other* type errors. The controller regenerates and re-checks before review.

- [ ] **Step 3: Commit**

```bash
git add src/app/setup/baby.tsx
git commit -m "feat(setup): add-baby step with a born-or-expecting fork"
```

---

### Task 6: Fold the connect form into the wizard

The connect form keeps everything that makes it work (saved servers, per-server reconnect, in-flight state, errors, the token help) and gains its place in the flow: a back arrow, and a post-connect decision that continues into the add-baby step when the server has no children. Its own "no server" escape hatch goes, because that is now the other branch of the question preceding it.

**Files:**
- Modify: `src/app/onboarding.tsx:1-15` (imports), `:23-34` (selectors and the connected effect), `:57-77` (back arrow), `:250-259` (remove the escape hatch)

**Interfaces:**
- Consumes: `nextAfterConnect` (Task 2), `useFinishSetup` (Task 3).
- Produces: nothing new.

- [ ] **Step 1: Update the imports**

In `src/app/onboarding.tsx`, add these two imports alongside the existing `@/` block:

```ts
import { nextAfterConnect } from '@/features/setup/routing';
import { useFinishSetup } from '@/features/setup/useFinishSetup';
```

Remove `openBrowserAsync` from the `expo-web-browser` import **only if** Step 4 leaves it unused. It does not: the "Learn how to host one" link stays. Keep the import.

- [ ] **Step 2: Replace the connected effect**

Replace these lines (currently 27 and 32-34):

```tsx
  const enterLocal = useAppStore((s) => s.enterLocal);
```

```tsx
  useEffect(() => {
    if (connected) router.replace('/(tabs)');
  }, [connected]);
```

with:

```tsx
  const children = useAppStore((s) => s.children);
  const finish = useFinishSetup();
```

```tsx
  // A fresh Baby Buddy install has no children on it, so connecting is not the
  // end of setup: continue into the add-baby step instead of dropping the user
  // on an empty Home. `children` is the raw store array, not a derived one, so
  // this selector is reference-stable.
  useEffect(() => {
    if (!connected) return;
    if (nextAfterConnect(children.length) === '/setup/baby') router.push('/setup/baby');
    else finish();
  }, [connected, children.length, finish]);
```

Note: `enterLocal` is removed because Step 4 deletes its only caller.

- [ ] **Step 3: Add the back arrow**

Immediately inside the `ScrollView`, before the 60x60 heart badge `View` (currently line 63), insert:

```tsx
      {router.canGoBack() && (
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={(s) => [
            { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginLeft: -8, marginBottom: 8, cursor: 'pointer' },
            isHovered(s) && { backgroundColor: t.chip },
          ]}
        >
          <Icon name="chevron-left" color={t.text} size={22} />
        </Pressable>
      )}
```

The guard matters: a returning user who disconnects lands here with nothing to go back to.

- [ ] **Step 4: Remove the escape hatch**

Delete the entire trailing `Pressable` (currently lines 250-259), the one whose label reads "No server? Start now, connect later". Keep the "Don't have a server? Learn how to host one" text above it: that is documentation, not a branch.

- [ ] **Step 5: Verify `enterLocal` is gone from this file**

Run: `grep -n "enterLocal" src/app/onboarding.tsx`
Expected: no output.

- [ ] **Step 6: Typecheck, lint, full suite**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: no errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/app/onboarding.tsx
git commit -m "feat(setup): fold the connect form into the wizard"
```

---

### Task 7: Home's no-child empty state

Skipping the baby step and the expecting branch both reach Home with no child, and so does deleting the last one. Today that renders a dashboard of tiles that log against nobody. Give it a way forward instead, in `DashboardContent` so phone and desktop both get it from one place.

**Files:**
- Create: `src/features/dashboard/NoChildCard.tsx`
- Modify: `src/features/dashboard/DashboardContent.tsx` (imports, plus an early return in the component body)

**Interfaces:**
- Consumes: `openAddChild` from the store, which opens the existing `ChildSheet` in create mode.
- Produces: `NoChildCard` from `@/features/dashboard/NoChildCard`.

- [ ] **Step 1: Create the card**

Create `src/features/dashboard/NoChildCard.tsx`:

```tsx
import { Pressable, View } from 'react-native';

import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { shadowStyle } from '@/theme/shadow';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

/**
 * Shown in place of the dashboard when there is no child to log against. Reached
 * by skipping the first-run add-baby step, by answering "not yet" to it, or by
 * deleting the last child. Opens the same create sheet the child switcher uses.
 */
export function NoChildCard() {
  const t = useTheme();
  const openAddChild = useAppStore((s) => s.openAddChild);

  return (
    <View
      style={{
        alignItems: 'center',
        paddingVertical: 40,
        paddingHorizontal: 24,
        borderRadius: 20,
        backgroundColor: t.surface,
        borderWidth: 1.5,
        borderColor: t.line2,
      }}
    >
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 18,
          backgroundColor: hexA(t.primary, t.dark ? 0.16 : 0.12),
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="heart" color={t.primary} size={26} />
      </View>

      <Txt weight={800} size={19} tracking={-0.3} style={{ marginTop: 18 }}>
        No baby yet
      </Txt>
      <Txt weight={500} size={14.5} color={t.dim} style={{ marginTop: 8, textAlign: 'center', lineHeight: 21 }}>
        Add your baby and Budkin starts tracking feeds, naps, nappies and growth.
      </Txt>

      <Pressable
        onPress={openAddChild}
        accessibilityRole="button"
        style={(s) => [
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            height: 50,
            paddingHorizontal: 22,
            borderRadius: 15,
            marginTop: 22,
            backgroundColor: t.primary,
            cursor: 'pointer',
          },
          shadowStyle(`0px 8px 22px ${hexA(t.primary, 0.35)}`),
          isHovered(s) && { opacity: 0.9 },
        ]}
      >
        <Icon name="plus" color={t.onPrimary} size={18} />
        <Txt unselectable weight={800} size={16} color={t.onPrimary}>
          Add your baby
        </Txt>
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 2: Early-return from `DashboardContent`**

In `src/features/dashboard/DashboardContent.tsx`, add the import alongside the existing `@/features/` import:

```ts
import { NoChildCard } from '@/features/dashboard/NoChildCard';
```

Then inside `DashboardContent`, add this selector directly after `const startQuickTimer = useAppStore((s) => s.startQuickTimer);`:

```ts
  // Primitive selector, so no new reference per render (zustand v5).
  const hasChild = useAppStore((s) => s.children.length > 0);
```

and add the early return immediately after it, before the `tileStyle` derivation:

```tsx
  if (!hasChild) return <NoChildCard />;
```

Every hook in `DashboardContent` sits in that opening block (lines 48-53, verified: the `useTheme` at line 285 belongs to a different component further down the same file), so returning here is below all hooks and the rules of hooks hold. Nothing after the return is a hook.

This also takes `MilestoneNudge` off the screen while there is no child, which is correct: it reads `child.birth` to pick prompts and has nothing to say without one.

- [ ] **Step 3: Typecheck, lint, full suite**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: no errors, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/features/dashboard/NoChildCard.tsx src/features/dashboard/DashboardContent.tsx
git commit -m "feat(home): empty state when there is no child to log against"
```

---

### Task 8: Drive both branches on web

The point of this work is that the flow feels right, which no unit test checks. Walk both branches end to end in a real browser against a fresh first-run state.

**Files:** none modified. This task verifies Tasks 1 to 7.

- [ ] **Step 1: Install and start the web build**

Run: `npm install && CI=1 npx expo start --web`

`expo-image-picker` is declared but may be uninstalled, which blocks `expo start` until `npm install` has run. `CI=1` caches the bundle, so restart the server to pick up any edit made after this point.

- [ ] **Step 2: Drive the local branch with headless Playwright**

Launch Chromium with `--no-sandbox`. Clear site data first so `tutorialSeen` is false, then load the app root and walk:

1. `/` lands on the welcome screen, showing "Welcome to Budkin" and both buttons.
2. Tap "Just use this device". Lands on "Has your baby arrived?".
3. Tap "Yes, they are here". The form shows first name, last name, and DD/MM/YYYY.
4. Type a first name, leave the date at today, tap "Add baby".
5. Home renders with the new child in the header and the dashboard tiles present, not the empty state.

Expected: no console errors, and specifically no "Maximum update depth exceeded".

- [ ] **Step 3: Drive the expecting and skip paths**

Clear site data, reload, then:

1. Welcome, "Just use this device", "Not yet".
2. The acknowledgement screen shows, tap "Got it".
3. Home renders the "No baby yet" card with a working "Add your baby" button that opens the child sheet.
4. Clear site data again and repeat through "Yes, they are here", then tap "Skip for now" instead of adding. Home shows the same empty state.

- [ ] **Step 4: Drive the server branch and the back arrow**

Clear site data, reload, then:

1. Tap "Yes, I have a server". The connect form shows with a back arrow and **no** "No server? Start now" link.
2. Tap the back arrow. Returns to the welcome screen.
3. Tap "Yes, I have a server" again, and confirm the token help and the "Learn how to host one" link are intact.

- [ ] **Step 5: Confirm the tour still works**

From Home, open Settings, and under Help tap "How Budkin works". The five-slide carousel opens, pages through, and "Get started" on the last slide returns to Settings rather than into setup. Reloading Home afterwards does not re-enter the wizard.

- [ ] **Step 6: Commit anything the run turned up**

If the run required fixes, commit them individually with the task they belong to. If it did not, there is nothing to commit and the branch is ready.

---

## Notes for the implementer

- **Do not touch** `src/features/walkthrough/slides.ts` or `src/features/walkthrough/Walkthrough.tsx`. They move routes, not contents.
- **The expecting child state is out of scope.** The "not yet" branch deliberately creates no child. The follow-up spec section in `docs/superpowers/specs/2026-07-18-onboarding-setup-wizard-design.md` covers the real version, and it changes the data model, four age displays, three feature views, and sync.
- **`app/index.tsx` needs no change.** It already sends a user with `tutorialSeen` false to `/welcome`, which is now the wizard's first step. Home's duplicate gate at `src/app/(tabs)/index.tsx:69` covers the web `/` route shadowing and also stays as it is.
