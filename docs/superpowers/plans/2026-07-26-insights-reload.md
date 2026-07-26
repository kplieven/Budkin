# Insights Reload (Pull-to-Refresh) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pull-to-refresh to the Insights tab so the user can force a re-fetch of the 90-day insights history, matching the other four data tabs.

**Architecture:** A new force-fetching `reloadInsights` store action re-pulls the history while keeping the current charts on screen (no full-screen loading flash) and fails quietly. The Insights screen wires the existing pull-to-refresh machinery (native `RefreshControl` + the touch-web gesture from `useWebPullToRefresh`) into its phone frame, exactly as `history.tsx` does. Desktop / mouse-web are unchanged.

**Tech Stack:** React Native, Expo (v56), Zustand v5 store, react-native-reanimated, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-26-insights-reload-design.md`

## Global Constraints

- Expo v56: check https://docs.expo.dev/versions/v56.0.0/ before writing code. This change adds no new Expo API surface (all APIs already used by `history.tsx`).
- No em-dashes in code comments or copy; use commas, colons, or separate sentences.
- Zustand v5: never return a fresh reference from a `useAppStore` selector. Reload wiring uses scalar/function selectors only.
- Reload re-fetches insights history only. Do NOT call `refresh()` or touch the main sync path.
- Touch only: native `RefreshControl` gated on `Platform.OS !== 'web'`; touch-web via `useWebPullToRefresh`. No desktop / mouse-web affordance.

## File Structure

- `src/store/useAppStore.ts` — add module-level `fetchInsightsEntries` helper (shared by `loadInsights` and `reloadInsights`), add the `reloadInsights` action and its interface entry.
- `src/store/useAppStore.test.ts` — add `reloadInsights` unit tests in the existing `insights slice` describe block.
- `src/app/(tabs)/insights.tsx` — wire pull-to-refresh into the phone `frame`.

---

### Task 1: Store — `reloadInsights` action + shared fetch helper

**Files:**
- Modify: `src/store/useAppStore.ts` (interface near `:216`; new helper near `childServerIdFor` at `:659`; refactor `loadInsights` at `:2179`; add `reloadInsights` after it at `:2214`)
- Test: `src/store/useAppStore.test.ts` (append to the `insights slice` describe, before its closing `});` at `:4581`)

**Interfaces:**
- Consumes: existing `childServerIdFor(children, childId)`, imported `loadInsightsHistory(conn, serverIdStr, sinceMs)`, `Entry` type, `AppState` type.
- Produces:
  - `async function fetchInsightsEntries(s: AppState, childId: string): Promise<Entry[]>` (module-level)
  - store action `reloadInsights: () => Promise<void>`

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('insights slice', ...)` block in `src/store/useAppStore.test.ts` (just before its closing `});`):

```ts
  it('reloadInsights re-fetches from the server even when already loaded, and swaps in the result', async () => {
    vi.mocked(loadInsightsHistory).mockClear();
    useAppStore.setState({
      connection: { mode: 'server', serverUrl: 'x', token: 'y' } as any,
      selectedChildId: 'c1',
      children: [SYNCED_C1],
      insightsLoaded: true, insightsLoading: false,
      insightsEntries: [{ id: 'old', type: 'sleep', childId: 'c1', start: 1, end: 2, nap: false, tags: [] } as any],
      insightsError: false,
    });
    vi.mocked(loadInsightsHistory).mockResolvedValueOnce([
      { id: 'fresh', type: 'sleep', childId: 'c1', start: 3, end: 4, nap: false, tags: [] } as any,
    ]);
    await useAppStore.getState().reloadInsights();
    expect(loadInsightsHistory).toHaveBeenCalledTimes(1);
    const s = useAppStore.getState();
    expect(s.insightsEntries.map((e) => e.id)).toEqual(['fresh']);
    expect(s.insightsLoaded).toBe(true);
    expect(s.insightsLoading).toBe(false);
  });

  it('reloadInsights keeps existing entries and does not set insightsError when the fetch fails', async () => {
    useAppStore.setState({
      connection: { mode: 'server', serverUrl: 'x', token: 'y' } as any,
      selectedChildId: 'c1',
      children: [SYNCED_C1],
      insightsLoaded: true, insightsLoading: false,
      insightsEntries: [{ id: 'keep', type: 'sleep', childId: 'c1', start: 1, end: 2, nap: false, tags: [] } as any],
      insightsError: false,
    });
    vi.mocked(loadInsightsHistory).mockRejectedValueOnce(new Error('network'));
    await useAppStore.getState().reloadInsights();
    const s = useAppStore.getState();
    expect(s.insightsEntries.map((e) => e.id)).toEqual(['keep']); // charts intact
    expect(s.insightsError).toBe(false); // good screen not replaced by the error state
    expect(s.insightsLoading).toBe(false);
    expect(s.insightsLoaded).toBe(true);
  });

  it('reloadInsights discards its result when the child switches mid-flight', async () => {
    vi.mocked(loadInsightsHistory).mockClear();
    useAppStore.setState({
      connection: { mode: 'server', serverUrl: 'x', token: 'y' } as any,
      selectedChildId: 'c1',
      children: [
        { id: 'c1', serverId: 501, first: 'Mira', last: 'O', birth: NOW, color: '#fff' },
        { id: 'c2', serverId: 502, first: 'Rio', last: '', birth: NOW, color: '#eee' },
      ],
      insightsLoaded: true, insightsLoading: false,
      insightsEntries: [{ id: 'c2keep', type: 'sleep', childId: 'c2', start: 1, end: 2, nap: false, tags: [] } as any],
      insightsError: false,
    });
    let resolveC1!: (v: Entry[]) => void;
    vi.mocked(loadInsightsHistory).mockImplementationOnce(
      () => new Promise<Entry[]>((r) => { resolveC1 = r; }),
    );
    const inFlight = useAppStore.getState().reloadInsights(); // c1 fetch starts
    useAppStore.setState({ selectedChildId: 'c2' }); // switch lands mid-flight
    resolveC1([{ id: 'c1stale', type: 'sleep', childId: 'c1', start: 9, end: 10, nap: false, tags: [] } as any]);
    await inFlight;
    const st = useAppStore.getState();
    expect(st.insightsEntries.map((e) => e.id)).toEqual(['c2keep']); // untouched, c1's result dropped
    expect(st.insightsLoading).toBe(false);
  });

  it('reloadInsights in demo mode re-scopes insightsEntries from local entries', async () => {
    useAppStore.setState({
      connection: { mode: 'local' } as any,
      selectedChildId: 'c1',
      entries: [
        { id: 'l1', type: 'sleep', childId: 'c1', start: 1, end: 2, nap: false, tags: [] } as any,
        { id: 'l2', type: 'sleep', childId: 'c2', start: 3, end: 4, nap: false, tags: [] } as any,
      ],
      insightsLoaded: true, insightsLoading: false,
      insightsEntries: [], insightsError: false,
    });
    await useAppStore.getState().reloadInsights();
    const s = useAppStore.getState();
    expect(s.insightsEntries.map((e) => e.id)).toEqual(['l1']); // c2 excluded
    expect(s.insightsLoaded).toBe(true);
  });

  it('reloadInsights no-ops while an initial load is already in flight', async () => {
    vi.mocked(loadInsightsHistory).mockClear();
    useAppStore.setState({
      connection: { mode: 'server', serverUrl: 'x', token: 'y' } as any,
      selectedChildId: 'c1',
      children: [SYNCED_C1],
      insightsLoaded: false, insightsLoading: true, // a load is running
      insightsEntries: [], insightsError: false,
    });
    await useAppStore.getState().reloadInsights();
    expect(loadInsightsHistory).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/store/useAppStore.test.ts -t reloadInsights`
Expected: FAIL. `reloadInsights` is not a function (TypeError), so every new case errors.

- [ ] **Step 3: Add the interface entry**

In `src/store/useAppStore.ts`, immediately after `loadInsights: () => Promise<void>;` (`:216`), add:

```ts
  /** Force a re-fetch of the insights history, keeping current charts on screen
   *  during the load (pull-to-refresh). Unlike loadInsights it ignores the
   *  loaded guard, and on failure it neither clears data nor sets an error. */
  reloadInsights: () => Promise<void>;
```

- [ ] **Step 4: Add the shared fetch helper**

In `src/store/useAppStore.ts`, immediately after the `childServerIdFor` function (ends `:670`), add:

```ts
// 90-day insights history for a child: local seed rows in demo mode, the server
// history otherwise (empty for a child that has never been pushed). Shared by
// loadInsights (first fill) and reloadInsights (manual refresh). Callers guard
// `connection` and `selectedChildId` before calling.
async function fetchInsightsEntries(s: AppState, childId: string): Promise<Entry[]> {
  const conn = s.connection!;
  if (conn.mode === 'local') return s.entries.filter((e) => e.childId === childId);
  const childServerId = childServerIdFor(s.children, childId);
  return childServerId == null
    ? []
    : loadInsightsHistory(conn, String(childServerId), s.now - 90 * 86400000);
}
```

- [ ] **Step 5: Refactor `loadInsights` to use the helper**

Replace the body of `loadInsights` (`:2179`-`:2214`) with:

```ts
  loadInsights: async () => {
    const s = get();
    if (s.insightsLoaded || s.insightsLoading) return;
    if (!s.connection || !s.selectedChildId) return;
    const childId = s.selectedChildId;
    set({ insightsLoading: true, insightsError: false });
    try {
      const entries = await fetchInsightsEntries(s, childId);
      if (get().selectedChildId !== childId) {
        // A child switch landed while this fetch was in flight — discard the
        // stale result and load for the now-selected child instead.
        set({ insightsLoading: false });
        get().loadInsights();
        return;
      }
      set({ insightsEntries: entries, insightsLoaded: true, insightsLoading: false });
    } catch {
      set({ insightsLoading: false, insightsError: true });
    }
  },
```

- [ ] **Step 6: Add the `reloadInsights` action**

Immediately after the `loadInsights` action's closing `},` (now around `:2200`), add:

```ts
  reloadInsights: async () => {
    const s = get();
    // Do NOT gate on insightsLoaded: forcing a re-fetch is the whole point.
    // Still bail if an initial load is already running, or there is nothing to fetch.
    if (s.insightsLoading) return;
    if (!s.connection || !s.selectedChildId) return;
    const childId = s.selectedChildId;
    // Leave insightsEntries / insightsLoaded in place so the charts stay on
    // screen while the fetch runs (no flash to the full-screen loading state).
    set({ insightsLoading: true });
    try {
      const entries = await fetchInsightsEntries(s, childId);
      if (get().selectedChildId !== childId) {
        // Child switch landed mid-flight; that child's mount effect will load it.
        set({ insightsLoading: false });
        return;
      }
      set({ insightsEntries: entries, insightsLoaded: true, insightsLoading: false, insightsError: false });
    } catch {
      // Manual refresh failed: keep the existing charts, drop the spinner, and
      // leave insightsError untouched so a good screen is not replaced by the
      // error state (and a pre-existing error stays put for its own retry button).
      set({ insightsLoading: false });
    }
  },
```

- [ ] **Step 7: Run the new tests and the whole insights slice to verify pass**

Run: `npx vitest run src/store/useAppStore.test.ts -t "reloadInsights"`
Expected: PASS (5 new tests).
Run: `npx vitest run src/store/useAppStore.test.ts -t "insights slice"`
Expected: PASS (existing `loadInsights` tests still green after the refactor).

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/store/useAppStore.ts src/store/useAppStore.test.ts
git commit -m "feat(insights): add reloadInsights store action for manual refresh"
```

---

### Task 2: Insights screen — wire pull-to-refresh into the phone frame

**Files:**
- Modify: `src/app/(tabs)/insights.tsx` (imports `:1`-`:3`; component body around `:64`/`:81`; `frame` at `:278`-`:286`)

**Interfaces:**
- Consumes: `reloadInsights` (Task 1); `useWebPullToRefresh(scrollRef, onRefresh)` returning `{ enabled, style, glyphStyle, refreshing }`.
- Produces: no new exports (screen-internal wiring).

- [ ] **Step 1: Update imports**

In `src/app/(tabs)/insights.tsx`:

Change line 1 from:
```ts
import { useEffect, useMemo, useState, type ReactNode } from 'react';
```
to:
```ts
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
```

Change line 2 from:
```ts
import { Pressable, ScrollView, View } from 'react-native';
```
to:
```ts
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, View } from 'react-native';
```

Add, immediately after line 2:
```ts
import Animated from 'react-native-reanimated';
```

Add, alongside the other `@/features` imports (after the `WaitingForBirth` import at `:9`):
```ts
import { useWebPullToRefresh } from '@/features/dashboard/useWebPullToRefresh';
```

- [ ] **Step 2: Add the reload selector and pull-to-refresh hooks**

In the component body, immediately after `const loadInsights = useAppStore((s) => s.loadInsights);` (`:64`), add:
```ts
  const reloadInsights = useAppStore((s) => s.reloadInsights);
```

Then, immediately after `const [width, setWidth] = useState(0);` (`:81`), add:
```ts
  // Pull-to-refresh, mirroring History: native uses the platform RefreshControl,
  // touch-web the custom gesture, mouse-web nothing. Reloads insights history only.
  const canPullToRefresh = Platform.OS !== 'web';
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    reloadInsights().finally(() => setRefreshing(false));
  }, [reloadInsights]);
  const scrollRef = useRef<ScrollView | null>(null);
  const webPull = useWebPullToRefresh(scrollRef, reloadInsights);
```

- [ ] **Step 3: Rewrite the phone branch of `frame`**

Replace the `frame` definition (`:278`-`:286`) with:

```tsx
  const frame = (inner: ReactNode) =>
    desktop ? (
      <DesktopPage maxWidth={640}>{inner}</DesktopPage>
    ) : (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        {webPull.enabled && (
          <Animated.View
            pointerEvents="none"
            style={[
              { position: 'absolute', top: insets.top - 6, left: 0, right: 0, alignItems: 'center', zIndex: 25 },
              webPull.style,
            ]}
          >
            <View style={{ width: 44, height: 44, borderRadius: 99, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, boxShadow: t.shadow }}>
              {webPull.refreshing ? (
                <ActivityIndicator color={t.dim} />
              ) : (
                <Animated.View style={webPull.glyphStyle}>
                  <Icon name="chevron-down" color={t.dim} size={22} />
                </Animated.View>
              )}
            </View>
          </Animated.View>
        )}
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1, backgroundColor: t.bg }}
          refreshControl={
            canPullToRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={t.dim}
                colors={['#E2B554']}
                progressViewOffset={insets.top}
              />
            ) : undefined
          }
          contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: 24 }}
        >
          {head}
          {inner}
        </ScrollView>
      </View>
    );
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run lint`
Expected: no new errors/warnings for `src/app/(tabs)/insights.tsx`.

- [ ] **Step 5: Manual verification on web (touch emulation)**

Per the run-on-web recipe, start Expo web and open Insights with a loaded child. In a touch-emulated viewport, drag down from the top: the puck appears and rotates, then spins while `reloadInsights` runs; existing charts remain visible throughout and update on completion. Confirm no horizontal scroll and no full-screen loading flash.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(tabs)/insights.tsx"
git commit -m "feat(insights): pull-to-refresh to reload the Insights tab"
```

---

## Self-Review

**1. Spec coverage:**
- `reloadInsights` action, force-fetch, keep-content, quiet-fail, stale-child, in-flight no-op, demo re-scope → Task 1 (impl + all 5 tests). ✓
- Shared `fetchInsightsEntries` helper, `loadInsights` delegates to it → Task 1 Steps 4-5. ✓
- Phone-frame pull-to-refresh (native + touch-web puck), desktop untouched, insights-only scope → Task 2. ✓
- "Try again" button left as-is; `refresh()` untouched → not modified in either task. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**3. Type consistency:** `reloadInsights` and `fetchInsightsEntries(s: AppState, childId: string): Promise<Entry[]>` named identically across interface, helper, action, and tests. `webPull` shape (`enabled/style/glyphStyle/refreshing`) matches `useWebPullToRefresh`'s return used in `history.tsx`. ✓
