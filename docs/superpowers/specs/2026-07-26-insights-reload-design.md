# Pull-to-refresh reload for the Insights tab

Date: 2026-07-26

## Problem

Insights is the only data tab without a manual reload. Home, History, Notes and
Timers all offer pull-to-refresh (native `RefreshControl` on device, a custom
touch gesture on web); Insights offers nothing.

That gap matters more here than on the other tabs because the insights data is a
separate lazily-loaded cache. `loadInsights` (`useAppStore.ts:2179`) fills
`insightsEntries` from a 90-day history and early-returns once
`insightsLoaded`. The screen's mount effect (`insights.tsx:149`) only calls it on
child switch, and `refresh()` (the main foreground/`AppState` sync) never touches
`insightsEntries`. So once the charts are on screen, the underlying data is
effectively frozen until the user switches child: new feeds, sleeps and diapers
logged elsewhere never appear.

## Goal

Add pull-to-refresh to the Insights tab, matching the other four data tabs, wired
to re-fetch the 90-day insights history. Touch only (native + touch-web), which
is where those tabs offer it. No desktop or mouse-web affordance, no change to
`refresh()`.

## What already works

The pull-to-refresh machinery is in place and reused verbatim by History
(`src/app/(tabs)/history.tsx`):

- `useWebPullToRefresh(scrollRef, onRefresh)`
  (`src/features/dashboard/useWebPullToRefresh.ts`) drives the touch-web gesture
  and returns `{ enabled, style, glyphStyle, refreshing }`. It is a no-op on
  native and on mouse-driven web.
- Native uses the platform `RefreshControl`, gated on `Platform.OS !== 'web'`.
- The animated puck (chevron that rotates while dragging, spinner once released)
  is a sibling overlay above the `ScrollView`.

The only thing missing is a store action that force-fetches. `loadInsights`
cannot be reused directly: it early-returns on `insightsLoaded || insightsLoading`,
and simply resetting `insightsLoaded` to false would flash the whole screen to
its full-screen "Loading insights..." state (`insights.tsx:302`).

## Design

### 1. Store (`src/store/useAppStore.ts`)

Extract the fetch body shared by first-fill and refresh into a module-level
helper, so the two paths cannot drift:

```ts
// 90-day insights history for a child: local seed rows in demo mode, the server
// history otherwise (empty for a child never pushed). Callers guard `connection`
// and `selectedChildId` first.
async function fetchInsightsEntries(s: AppState, childId: string): Promise<Entry[]> {
  const conn = s.connection!;
  if (conn.mode === 'local') return s.entries.filter((e) => e.childId === childId);
  const childServerId = childServerIdFor(s.children, childId);
  return childServerId == null
    ? []
    : loadInsightsHistory(conn, String(childServerId), s.now - 90 * 86400000);
}
```

`loadInsights` keeps its exact behaviour, now delegating the fetch to the helper
(guard, `insightsLoading: true`/`insightsError: false`, stale-child recursion,
and the `catch` that sets `insightsError` are all unchanged).

Add a sibling action, `reloadInsights`:

```ts
reloadInsights: async () => {
  const s = get();
  // Do NOT gate on insightsLoaded: forcing a re-fetch is the point. Still bail
  // if an initial load is already running, or there is nothing to fetch.
  if (s.insightsLoading) return;
  if (!s.connection || !s.selectedChildId) return;
  const childId = s.selectedChildId;
  // Leave insightsEntries / insightsLoaded in place so the charts stay on screen
  // while the fetch runs (no flash to the full-screen loading state).
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
    // leave insightsError untouched. A good screen must not be replaced by the
    // error state, and a pre-existing error stays put for its own retry button.
    set({ insightsLoading: false });
  }
},
```

Add `reloadInsights: () => Promise<void>;` to the `AppActions` interface beside
`loadInsights` (`useAppStore.ts:216`).

Two deliberate differences from `loadInsights`:

- It does not clear `insightsEntries`/`insightsLoaded` up front, so the current
  charts stay visible during the fetch. That is the pull-to-refresh contract:
  content stays, a spinner rides on top.
- On failure it does not set `insightsError`. A failed manual refresh from a good
  screen leaves the charts intact (matching how the other tabs' `refresh()` fails
  quietly), rather than throwing away data the user is looking at.

### 2. Insights screen (`src/app/(tabs)/insights.tsx`)

Mirror History's wiring. In the component body:

```ts
const reloadInsights = useAppStore((s) => s.reloadInsights);
const canPullToRefresh = Platform.OS !== 'web';
const [refreshing, setRefreshing] = useState(false);
const onRefresh = useCallback(() => {
  setRefreshing(true);
  reloadInsights().finally(() => setRefreshing(false));
}, [reloadInsights]);
const scrollRef = useRef<ScrollView | null>(null);
const webPull = useWebPullToRefresh(scrollRef, reloadInsights);
```

The native `RefreshControl` uses the local `refreshing` state; the touch-web
gesture manages its own `refreshing` inside the hook. `reloadInsights` is the
single onRefresh callback for both.

Wire refresh into the phone branch of `frame` (the desktop `DesktopPage` branch
is untouched, so desktop and mouse-web get no pull-to-refresh, exactly as chosen
and exactly as History behaves):

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
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.dim} colors={['#E2B554']} progressViewOffset={insets.top} />
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

Because `frame` wraps the body, the loading state and the error state alike, all
three get pull-to-refresh on the phone. That is a small bonus: a pull from the
error state runs `reloadInsights`, and on success the charts appear (a failed
initial load has `insightsLoaded` false, so `reloadInsights` fills it). The
existing "Try again" button (`insights.tsx:299`) is left as-is.

New imports: `useCallback`, `useRef` from `react`; `ActivityIndicator`,
`Platform`, `RefreshControl` from `react-native`; `Animated` from
`react-native-reanimated`; `useWebPullToRefresh` from
`@/features/dashboard/useWebPullToRefresh`. `Icon`, `ScrollView`, `View`,
`useSafeAreaInsets` are already imported.

## Testing

Store unit tests, alongside the existing `loadInsights` coverage in
`src/store/useAppStore.test.ts` (the demo-mode `loadInsights` test is at 4423):

- `reloadInsights` re-fetches even when `insightsLoaded` is already true. In
  server mode this calls `loadInsightsHistory` again and swaps the result into
  `insightsEntries`.
- On fetch failure it keeps the existing `insightsEntries` and does not set
  `insightsError` (start from a loaded, error-free state; assert both hold).
- It bails when a child switch lands mid-flight: `selectedChildId` changes before
  the fetch resolves, so the stale result is discarded and `insightsEntries` is
  left as the pre-reload value.
- Demo (local) mode re-scopes `insightsEntries` from the store's `entries` for
  the selected child.
- `reloadInsights` no-ops while `insightsLoading` is true (no second
  `loadInsightsHistory` call).

Manual check on web (touch emulation) per the run-on-web recipe: with the tab
loaded, a downward drag from the top shows the puck and refreshes; existing
charts stay visible throughout.

## Out of scope

- `refresh()` and the main sync path. Reload re-fetches insights history only.
- Any desktop or mouse-web reload affordance (no TopBar reload button).
- Automatic, interval or focus-based insights reloading.
- Reworking the error-state "Try again" button. It keeps its current
  `setState` + `loadInsights` path.

## Implementation note

Per `AGENTS.md`, check https://docs.expo.dev/versions/v56.0.0/ before writing
code. This change adds no new Expo API surface: `RefreshControl`,
`ActivityIndicator`, `Platform`, reanimated `Animated`, and `useWebPullToRefresh`
are all already used by `history.tsx` and its siblings.
