# First-run Walkthrough Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a brand-new user a five-slide intro carousel the first time they open Budkin, and let anyone replay it from Settings.

**Architecture:** A presentational carousel component (`Walkthrough`) driven by a static slide-data array, mounted at a new `/welcome` route. A persisted `tutorialSeen` flag (in the existing prefs blob, surfaced as store state) gates the route: `index.tsx` sends first-run users to `/welcome` before the connect screen. A `completeTutorial()` store action flips and persists the flag; the route component owns the post-dismiss navigation. A new Settings "Help" row replays it via `/welcome?replay=1`.

**Tech Stack:** Expo Router (SDK 56, typed routes), React Native (horizontal paging `ScrollView`), Zustand store, AsyncStorage-backed prefs, Vitest.

## Global Constraints

- **Expo SDK is 56.** Verify any Expo/expo-router API against the versioned docs at https://docs.expo.dev/versions/v56.0.0/ before using it. Typed routes are on (`app.json` `experiments.typedRoutes`), so pass route params as an object (`router.push({ pathname: '/welcome', params: { replay: '1' } })`), never a query string.
- **No em-dashes** in any user-facing copy, comments, or docs. Use commas, colons, or separate sentences.
- **Theme everything** via `useTheme()` tokens (`t.primary`, `t.dim`, `t.line2`, `t.onPrimary`, `t.bg`, `t.surface`, `t.dark`, ...). No hardcoded colors except where the codebase already does (activity tints).
- **Store actions never navigate.** Navigation lives in route/screen components (mirrors how `disconnect()` + `router.replace` are split today).
- **Web + phone + desktop** must all work. The carousel renders as a centered, max-width column so it is not full-bleed on wide screens.
- Follow existing file idioms: `Txt`/`Icon` components, `isHovered` for hover states, `hexA` for alpha, `shadowStyle` for shadows.

---

### Task 1: Persist `tutorialSeen` and add the `completeTutorial` store action

**Files:**
- Modify: `src/data/prefs.ts` (add field to `Prefs`)
- Modify: `src/store/useAppStore.ts` (state field, action, hydrate restore)
- Test: `src/store/useAppStore.test.ts` (new `describe` block)

**Interfaces:**
- Consumes: existing `loadPrefs`/`savePrefs` (already imported in the store), existing `hydrate()`.
- Produces:
  - `Prefs.tutorialSeen?: boolean`
  - store state `tutorialSeen: boolean` (default `false`)
  - store action `completeTutorial: () => void`, which sets `tutorialSeen: true` and calls `savePrefs({ tutorialSeen: true })`.

- [ ] **Step 1: Write the failing tests**

Add this block at the end of `src/store/useAppStore.test.ts` (the `s` helper `() => useAppStore.getState()` and the `savePrefs`/`loadConnection` mocks already exist in this file):

```ts
describe('walkthrough persistence', () => {
  it('completeTutorial sets tutorialSeen and persists via savePrefs', () => {
    useAppStore.setState({ tutorialSeen: false });
    s().completeTutorial();
    expect(s().tutorialSeen).toBe(true);
    expect(savePrefs).toHaveBeenCalledWith({ tutorialSeen: true });
  });

  it('hydrate applies a persisted tutorialSeen', async () => {
    h.prefs = { tutorialSeen: true };
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    useAppStore.setState({ tutorialSeen: false });
    await s().hydrate();
    expect(s().tutorialSeen).toBe(true);
  });

  it('hydrate leaves tutorialSeen false when nothing was persisted', async () => {
    h.prefs = {};
    vi.mocked(loadConnection).mockResolvedValueOnce(null);
    useAppStore.setState({ tutorialSeen: false });
    await s().hydrate();
    expect(s().tutorialSeen).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/store/useAppStore.test.ts -t "walkthrough persistence"`
Expected: FAIL (`completeTutorial` is not a function; `tutorialSeen` undefined).

- [ ] **Step 3: Add the prefs field**

In `src/data/prefs.ts`, extend the `Prefs` interface:

```ts
export interface Prefs {
  themeMode: ThemeMode;
  /** Budkin-local metric/imperial display lens (default 'metric'). */
  unitSystem: UnitSystem;
  /** true once the first-run walkthrough carousel has been dismissed. */
  tutorialSeen: boolean;
}
```

(No change to `loadPrefs`/`savePrefs`: they already return/merge `Partial<Prefs>`.)

- [ ] **Step 4: Add store state, action, and hydrate restore**

In `src/store/useAppStore.ts`:

In the `AppState` interface, next to `themeMode`/`unitSystem`, add:

```ts
  /** true once the first-run walkthrough carousel has been dismissed. */
  tutorialSeen: boolean;
```

In the `AppActions` interface, next to `toggleTheme`, add:

```ts
  /** Mark the first-run walkthrough as seen (persisted). */
  completeTutorial: () => void;
```

In the initial state object, next to `unitSystem: 'metric',`, add:

```ts
  tutorialSeen: false,
```

In the actions, right after the `toggleTheme` implementation, add:

```ts
  completeTutorial: () => {
    set({ tutorialSeen: true });
    void savePrefs({ tutorialSeen: true });
  },
```

In `hydrate()`, right after the existing `if (prefs.unitSystem) set({ unitSystem: prefs.unitSystem });` line, add:

```ts
    if (prefs.tutorialSeen) set({ tutorialSeen: true });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/store/useAppStore.test.ts -t "walkthrough persistence"`
Expected: PASS (3 tests).

- [ ] **Step 6: Full suite + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all tests PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/data/prefs.ts src/store/useAppStore.ts src/store/useAppStore.test.ts
git commit -m "feat(walkthrough): persist tutorialSeen + completeTutorial action"
```

---

### Task 2: Slide deck data

**Files:**
- Create: `src/features/walkthrough/slides.ts`

**Interfaces:**
- Consumes: `IconName` from `@/components/Icon`.
- Produces:
  - `interface WalkthroughSlide { icon: IconName; headline: string; body: string }`
  - `const WALKTHROUGH_SLIDES: WalkthroughSlide[]`: the five slides, headlines unique (used as React keys downstream).

- [ ] **Step 1: Create the slide data file**

Create `src/features/walkthrough/slides.ts`:

```ts
import type { IconName } from '@/components/Icon';

export interface WalkthroughSlide {
  icon: IconName;
  headline: string;
  body: string;
}

/** The first-run walkthrough deck. Headlines are unique (used as React keys). */
export const WALKTHROUGH_SLIDES: WalkthroughSlide[] = [
  {
    icon: 'heart',
    headline: 'Welcome to Budkin',
    body: "A calm, fast way to track your baby's day, from feeds and naps to the milestones in between.",
  },
  {
    icon: 'feeding',
    headline: 'Log in seconds',
    body: 'Tap a tile on Home to record a feed, nap, diaper, bath and more. Smart defaults mean most logs are one or two taps.',
  },
  {
    icon: 'timer',
    headline: 'Timers for naps and feeds',
    body: "Start a live timer and save it as any activity when you're done. On Android there's even a home-screen widget to start a nap without opening the app.",
  },
  {
    icon: 'insights',
    headline: 'See the patterns',
    body: 'History, Insights, Growth and Milestones turn your entries into trends: sleep totals, feeding rhythms, growth curves.',
  },
  {
    icon: 'home',
    headline: 'Yours, offline-first',
    body: 'Budkin works fully offline and keeps data on your device. Connect your own Baby Buddy server to sync across devices, or start now and connect later.',
  },
];
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (each `icon` is a valid `IconName`: heart, feeding, timer, insights, home all exist in `src/components/Icon.tsx`).

- [ ] **Step 3: Commit**

```bash
git add src/features/walkthrough/slides.ts
git commit -m "feat(walkthrough): five-slide intro deck data"
```

---

### Task 3: The `Walkthrough` carousel component

**Files:**
- Create: `src/features/walkthrough/Walkthrough.tsx`

**Interfaces:**
- Consumes: `WALKTHROUGH_SLIDES` (Task 2); `useTheme`, `Txt`, `Icon`, `isHovered`, `hexA`, `shadowStyle`.
- Produces: `export function Walkthrough({ onDone }: { onDone: () => void })`, which renders the paged carousel and calls `onDone()` when Skip is tapped or Get started (last slide) is pressed.

- [ ] **Step 1: Create the component**

Create `src/features/walkthrough/Walkthrough.tsx`:

```tsx
import { useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { WALKTHROUGH_SLIDES } from '@/features/walkthrough/slides';
import { hexA } from '@/lib/color';
import { shadowStyle } from '@/theme/shadow';
import { useTheme } from '@/theme/useTheme';

/**
 * First-run intro carousel. Five swipeable slides (horizontal paging ScrollView),
 * a page-dot indicator, a Skip control (all but the last slide), and a primary
 * button that reads Next until the last slide, where it becomes Get started.
 * Presentational: the caller owns what "done" means (persist + navigate).
 */
export function Walkthrough({ onDone }: { onDone: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  // Measured pager width (<= maxWidth). Slides are sized to this so paging snaps
  // cleanly on both phone and a constrained desktop column.
  const [width, setWidth] = useState(0);
  const scrollRef = useRef<ScrollView | null>(null);

  const last = index >= WALKTHROUGH_SLIDES.length - 1;

  const goTo = (i: number) => {
    const clamped = Math.max(0, Math.min(WALKTHROUGH_SLIDES.length - 1, i));
    setIndex(clamped);
    scrollRef.current?.scrollTo({ x: clamped * width, animated: true });
  };

  const next = () => {
    if (last) onDone();
    else goTo(index + 1);
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      {/* Skip (hidden on the last slide, where the primary button dismisses) */}
      <View style={{ height: 48, justifyContent: 'center', alignItems: 'flex-end', paddingHorizontal: 20 }}>
        {!last && (
          <Pressable
            onPress={onDone}
            accessibilityRole="button"
            accessibilityLabel="Skip"
            style={(s) => [{ paddingVertical: 8, paddingHorizontal: 6, cursor: 'pointer' }, isHovered(s) && { opacity: 0.7 }]}
          >
            <Txt unselectable weight={600} size={15} color={t.dim}>
              Skip
            </Txt>
          </Pressable>
        )}
      </View>

      {/* pager: centered, max-width column so it is not full-bleed on desktop */}
      <View
        style={{ flex: 1, alignSelf: 'center', width: '100%', maxWidth: 460 }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        {width > 0 && (
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
          >
            {WALKTHROUGH_SLIDES.map((slide) => (
              // Horizontal ScrollView children stretch to the viewport height on
              // the cross axis, so justifyContent centers the slide vertically.
              <View key={slide.headline} style={{ width, paddingHorizontal: 32, alignItems: 'center', justifyContent: 'center' }}>
                <View
                  style={{
                    width: 96,
                    height: 96,
                    borderRadius: 30,
                    backgroundColor: hexA(t.primary, t.dark ? 0.16 : 0.12),
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name={slide.icon} color={t.primary} size={44} />
                </View>
                <Txt weight={800} size={26} tracking={-0.5} style={{ textAlign: 'center', marginTop: 28, lineHeight: 32 }}>
                  {slide.headline}
                </Txt>
                <Txt weight={500} size={15.5} color={t.dim} style={{ textAlign: 'center', marginTop: 12, lineHeight: 23 }}>
                  {slide.body}
                </Txt>
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      {/* page dots (active dot widens) */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 8, marginBottom: 20 }}>
        {WALKTHROUGH_SLIDES.map((slide, i) => (
          <View
            key={slide.headline}
            style={{
              width: i === index ? 22 : 8,
              height: 8,
              borderRadius: 99,
              backgroundColor: i === index ? t.primary : t.line2,
            }}
          />
        ))}
      </View>

      {/* primary button */}
      <View style={{ paddingHorizontal: 24, paddingBottom: 8 }}>
        <Pressable
          onPress={next}
          accessibilityRole="button"
          accessibilityLabel={last ? 'Get started' : 'Next'}
          style={(s) => [
            {
              height: 56,
              borderRadius: 17,
              backgroundColor: t.primary,
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            },
            shadowStyle(`0px 8px 22px ${hexA(t.primary, 0.35)}`),
            isHovered(s) && { opacity: 0.9 },
          ]}
        >
          <Txt unselectable weight={800} size={17} color={t.onPrimary}>
            {last ? 'Get started' : 'Next'}
          </Txt>
        </Pressable>
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no type errors; lint clean.

- [ ] **Step 3: Commit**

```bash
git add src/features/walkthrough/Walkthrough.tsx
git commit -m "feat(walkthrough): paged intro carousel component"
```

---

### Task 4: `/welcome` route, first-run gating, and shell exclusion

**Files:**
- Create: `src/app/welcome.tsx`
- Modify: `src/app/index.tsx` (first-run redirect branch)
- Modify: `src/app/_layout.tsx` (register `welcome` screen; exclude from desktop shell)

**Interfaces:**
- Consumes: `Walkthrough` (Task 3); store `tutorialSeen` + `completeTutorial` (Task 1); `connected`.
- Produces: a reachable `/welcome` route; `index.tsx` routes first-run users to it.

- [ ] **Step 1: Create the route wrapper**

Create `src/app/welcome.tsx`:

```tsx
import { router, useLocalSearchParams } from 'expo-router';

import { Walkthrough } from '@/features/walkthrough/Walkthrough';
import { useAppStore } from '@/store/useAppStore';

/**
 * The first-run walkthrough route. `?replay=1` (set by the Settings row) means
 * this was reopened from inside the app, so dismiss returns via back(); on a
 * genuine first run it advances into the connect flow (or the app if already
 * connected). Marking the tutorial seen happens in both paths.
 */
export default function Welcome() {
  const params = useLocalSearchParams<{ replay?: string }>();
  const replay = params.replay === '1';
  const connected = useAppStore((s) => s.connected);
  const completeTutorial = useAppStore((s) => s.completeTutorial);

  const done = () => {
    completeTutorial();
    if (replay) router.back();
    else router.replace(connected ? '/(tabs)' : '/onboarding');
  };

  return <Walkthrough onDone={done} />;
}
```

- [ ] **Step 2: Gate first run in `index.tsx`**

Replace the body of `src/app/index.tsx` with:

```tsx
import { Redirect } from 'expo-router';

import { useAppStore } from '@/store/useAppStore';

/**
 * Entry route: show the first-run walkthrough until it has been seen, then send
 * to the app if connected, otherwise to onboarding.
 */
export default function Index() {
  const tutorialSeen = useAppStore((s) => s.tutorialSeen);
  const connected = useAppStore((s) => s.connected);
  if (!tutorialSeen) return <Redirect href="/welcome" />;
  return <Redirect href={connected ? '/(tabs)' : '/onboarding'} />;
}
```

- [ ] **Step 3: Register the screen and exclude it from the desktop shell**

In `src/app/_layout.tsx`:

Add a screen inside the `<Stack>` (next to the other `<Stack.Screen>` entries), after `<Stack.Screen name="onboarding" />`:

```tsx
      <Stack.Screen name="welcome" />
```

Change the `showShell` line so the carousel is full-screen on desktop too (it is a pre-app route like onboarding). Replace:

```tsx
  const showShell = desktop && segments[0] !== 'onboarding';
```

with:

```tsx
  const showShell = desktop && segments[0] !== 'onboarding' && segments[0] !== 'welcome';
```

Also update the comment above it so it mentions welcome (replace the parenthetical "Hidden on onboarding (a full-screen, pre-app route)." with "Hidden on onboarding and welcome (full-screen, pre-app routes).").

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no type errors (typed routes now include `/welcome`); lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/welcome.tsx src/app/index.tsx src/app/_layout.tsx
git commit -m "feat(walkthrough): /welcome route + first-run gating"
```

---

### Task 5: Settings "Help" section with the replay row

**Files:**
- Modify: `src/app/settings.tsx`

**Interfaces:**
- Consumes: `router` (already imported), `Icon` (new import), the existing `group`/`row`/`sectionLabel` style objects.
- Produces: a "Help" section whose single row opens `/welcome?replay=1`.

- [ ] **Step 1: Import `Icon`**

In `src/app/settings.tsx`, add to the imports (next to the other `@/components` imports):

```tsx
import { Icon } from '@/components/Icon';
```

- [ ] **Step 2: Add the Help section**

In `src/app/settings.tsx`, inside the `body` JSX, immediately after the closing `</View>` of the Server `group` (the `<View style={group}>...</View>` that ends the Server section) and before the closing `</>`, add:

```tsx
      <Txt weight={700} size={12.5} color={t.faint} tracking={0.8} style={{ ...sectionLabel, textTransform: 'uppercase' }}>
        Help
      </Txt>
      <View style={group}>
        <Pressable
          onPress={() => router.push({ pathname: '/welcome', params: { replay: '1' } })}
          accessibilityRole="button"
          style={(s) => [row, { cursor: 'pointer' }, isHovered(s) && { backgroundColor: t.elevated }]}
        >
          <Txt unselectable weight={600} size={16} color={t.primary} style={{ flex: 1 }}>
            Show the walkthrough
          </Txt>
          <Icon name="chevron-right" color={t.faint} size={18} />
        </Pressable>
      </View>
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no type errors; lint clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/settings.tsx
git commit -m "feat(walkthrough): Settings Help row to replay the walkthrough"
```

---

### Task 6: End-to-end verification on web

**Files:** none (verification only)

This project verifies UI on Expo web with headless Playwright (see the run-on-web recipe). Reset the flag between runs by clearing site storage or running in a fresh/incognito context.

- [ ] **Step 1: Run the full test suite + typecheck + lint once more**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all green.

- [ ] **Step 2: Start the web app**

Run: `npm run web` (Expo web). If `expo start` complains about `expo-image-picker` being declared-but-uninstalled, run `npm install` first (per the run-on-web note).

- [ ] **Step 3: First-run path (fresh storage)**

In a fresh browser context, load the app. Verify:
- The walkthrough shows first (before the connect screen).
- Swiping / Next advances through all five slides; dots track position; Skip appears on slides 1 to 4 and not on slide 5.
- Slide 5's button reads "Get started"; pressing it lands on the connect-your-server screen.
- Reload the page: the walkthrough does NOT reappear (it goes straight to the connect screen). This confirms `tutorialSeen` persisted.

- [ ] **Step 4: Replay path**

Enter the app (connect a server or pick "Start now, connect later"), open Settings, scroll to **Help**, tap **Show the walkthrough**. Verify:
- The carousel opens.
- Dismissing it (Skip, or Get started on slide 5) returns to Settings (back), not to onboarding.

- [ ] **Step 5: Desktop width check**

Widen the browser to desktop width and reopen via Settings. Verify the carousel renders as a centered, max-width column (not full-bleed) and the sidebar shell is not shown over it.

- [ ] **Step 6: Commit (only if any fixes were needed)**

```bash
git add -A
git commit -m "fix(walkthrough): verification fixups"
```

---

## Self-Review

**Spec coverage:**
- Five-slide carousel, before connect: Tasks 2, 3, 4. ✓
- Icons/copy per deck table: Task 2 (heart/feeding/timer/insights/home). ✓
- Swipe + dots + Skip + Next/Get started: Task 3. ✓
- Safe-area + desktop centered column: Task 3 (insets, maxWidth) + Task 4 (shell exclusion). ✓
- `tutorialSeen` in prefs blob + store field + hydrate restore + `completeTutorial`: Task 1. ✓
- `/welcome` route registered + excluded from shell: Task 4. ✓
- `index.tsx` first-run branch: Task 4. ✓
- First-run vs replay via `replay` param, back() vs replace: Task 4 (`welcome.tsx`). ✓
- Settings "Help" section replay row: Task 5. ✓
- Tests (completeTutorial + hydrate restore): Task 1. ✓
- Manual verification: Task 6. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command has an expected result. ✓

**Type consistency:** `tutorialSeen: boolean` and `completeTutorial: () => void` are used identically across Tasks 1/4/5. `WalkthroughSlide`/`WALKTHROUGH_SLIDES` and `Walkthrough({ onDone })` match across Tasks 2/3/4. Route param key `replay` matches between `welcome.tsx` (Task 4) and the Settings push (Task 5). ✓
