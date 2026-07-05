# Insights tab — sleep-rhythm heatmap + normative trend curves

**Date:** 2026-07-05
**Status:** Approved, ready for planning

## Problem

Budkin logs rich longitudinal data — sleep, feeds, diapers, pumping, tummy time,
growth — but surfaces it only as *point-in-time status* (the Home dashboard) and
a flat *reverse-chronological log* (History). There is nowhere a parent can see
**patterns over time**: whether a sleep schedule is forming, whether the longest
night stretch is trending toward "sleeping through," whether feed frequency and
diaper output sit where they typically do for the baby's age. Parents want two
things the app can't currently answer:

1. *"Is a rhythm emerging?"* — a felt, at-a-glance sense of the day taking shape.
2. *"Is this normal for our baby's age?"* — reassurance anchored to real numbers.

## Goal

A new **Insights** tab (5th tab) that is **purely retrospective** and answers
both questions:

- A **sleep-rhythm heatmap** — the hero. Four weeks of days stacked vertically,
  the 24h clock horizontal, sleep shaded in. Reading top-to-bottom, the parent
  watches fragmented newborn sleep consolidate into a night block plus regular
  naps.
- Six **trend curves** grouped by domain, each a real chart (numbered axes,
  gridlines, dated x-axis) with the current value, a trend delta, and — where
  honestly sourced — an **age-tracking "typical for age" band**.

## Non-goals

- **No predictions.** "Next nap ~2:30 PM" style forecasting is explicitly out;
  it belongs on the Home tab (actionable, glanceable) and is a separate later
  task. This tab only describes what *has* happened.
- **No WHO growth-percentile curves.** Weight/height/head percentile curves are
  wanted eventually but on the **Growth/measurements tab**, not here. Out of
  scope.
- **No editing** of entries from Insights — it is read-only. Editing stays in
  History / the log sheets.
- **No cross-metric correlation** ("feeds vs sleep") — YAGNI for v1.
- **No new server writes.** Insights only reads.

## Decisions (resolved during brainstorming)

### Scope
- **In:** sleep-rhythm heatmap + 6 trend cards. **Retrospective only.**
- The six metrics: **Total sleep/day**, **Longest stretch/night**, **Avg wake
  window** (Sleep); **Feeds/day**, **Avg interval between feeds** (Feeding);
  **Wet vs dirty/day** (Diapers).

### Time range
- **Heatmap: fixed 4-week (28-day) window.** More rows get too thin to read; the
  window never changes and carries its own "Last 4 weeks" caption.
- **Trends: a range selector — 2 weeks / 1 month / 3 months.** The selector
  governs **only the trend charts**; the heatmap ignores it. A small "Applies to
  trend charts" caption under the selector makes the scoping honest. Confirmed
  acceptable (the heatmap-vs-trends span mismatch is intentional).
- The deep data fetch must cover the **maximum (≈90 days)**.

### Heatmap design
- **Rows = noon-to-noon periods** (one row per day), newest at the **bottom**
  (labelled "Today"), 4 weeks ago at the top.
- **Midnight-centred x-axis (12 PM → 12 PM).** The single most important visual
  call: night sleep lands as a **contiguous block in the middle** instead of
  being split across the left/right edges (which a midnight-to-midnight axis
  does). It also makes the day-bucketing clean — a normal night (≈8 PM–6 AM)
  falls entirely inside one noon-to-noon row, so no entry is split across rows.
- **Night = indigo, Nap = lilac**, keyed off Baby Buddy's `SleepEntry.nap` flag
  (not a time heuristic). Awake time is the faint track behind each row.
- x-axis ticks at 12 PM / 6 PM / 12 AM (centre) / 6 AM / 12 PM; sparse y labels
  (Today, 1w, 2w, 3w, 4w).

### Trend cards
- Each card: domain-colour dot + label, big **current value + unit**, a **delta
  pill** (green when the change is a *good* one — e.g. longest stretch climbing
  +4.2h — neutral grey otherwise), and a chart with **numbered y-axis, faint
  gridlines, and a dated x-axis**.
- Grouped under section headers **SLEEP / FEEDING / DIAPERS**, in that order.

### Normative "typical for age" bands
- **Framing is "typical," never "should."** An ⓘ affordance on each banded card
  cites the source and states *"general guidance, not medical advice; ranges
  vary — ask your pediatrician."* This avoids alarming a parent whose baby dips
  out of a population range for a day.
- **Bands track the baby's age.** Because a 90-day chart spans real developmental
  change and the birth date is known, the band **steps** as the baby crosses age
  buckets rather than sitting as one flat blob.
- **Only band what is genuinely sourced**, with visually-downgraded confidence
  for rules of thumb:

  | Metric | Band treatment | Source |
  |---|---|---|
  | Total sleep / day | **Solid band** | National Sleep Foundation / AASM by age |
  | Feeds / day | **Solid band** | AAP general feeding guidance by age |
  | Wet diapers / day | **Floor line** ("≥6 typical") | AAP hydration guidance |
  | Avg wake window | **Dashed "rule of thumb"** band | sleep-consultant norms |
  | Longest stretch / night | **Dashed "rule of thumb"** band | sleep-consultant norms |
  | Dirty diapers / day | **No band** (too variable) | — |

  Solid bands render filled; rule-of-thumb bands render lighter with a dashed
  outline and a literal "rule of thumb" label.

### Navigation
- **5th bottom tab**, "Insights" — confirmed comfortable. Needs a **distinct
  icon** from Growth's existing `chart` glyph.

## Architecture

New code is concentrated under `src/features/insights/`, split into **pure
computation** (trivially unit-testable, no React) and **SVG chart components**.
Charts use `react-native-svg` (already a dependency). The screen reuses the
existing `useTheme`, `Txt`, `Avatar`, `DesktopPage`, and hover patterns, exactly
like `growth.tsx`.

### 1. Route + navigation registration
- **`src/app/(tabs)/insights.tsx`** (new) — the screen. Same phone/desktop split
  as `growth.tsx`: a `<ScrollView>` with a title row (`Insights` + child avatar
  that opens the switcher) on phone; wrapped in `<DesktopPage maxWidth={640}>` on
  desktop.
- **`src/app/(tabs)/_layout.tsx`** — add `<Tabs.Screen name="insights"
  options={{ title: 'Insights' }} />`.
- **`src/components/TabBar.tsx`** — add `insights: { label: 'Insights', icon:
  'insights' }` to the `TABS` record. (Order in the bar follows the route order;
  place after `growth`.)
- **`src/shell/Sidebar.tsx`** — add an `Insights` `NAV` item (`href:
  '/insights'`, `match: (p) => p.startsWith('/insights')`) before Settings.
- **`src/shell/labels.ts`** — add `case '/insights': return 'Insights';` to
  `screenTitleFor`; update `labels.test.ts`.

### 2. Icon
- **`src/components/Icon.tsx`** — add `'insights'` to the `IconName` union and a
  glyph (a small three-bar chart / rising bars) visually distinct from `chart`
  (used by Growth). Stroked, matching the other UI icons.

### 3. Deep history load (data)
The store currently holds only the last 50 entries/type (`loadFromServer` →
`client.list*(childId, 50)`), which is ~10 days of newborn sleep — not enough.
Insights needs ≈90 days **without** slowing app startup.

- **`src/data/repository.ts`** — new `loadInsightsHistory(conn, childId,
  sinceMs): Promise<Entry[]>`. Fetches sleep + feedings + changes (the types
  Insights charts) going back to `sinceMs` using the **already-proven LimitOffset
  pagination** (`ordering=-start` / `-time`, `limit`+`offset`), paging until an
  entry falls before `sinceMs`, then trimming. This relies only on pagination the
  client already documents — no dependence on server-side date filters we haven't
  verified. Pumping/tummy are not charted, so not fetched here.
- **`src/api/client.ts`** — the `list*` methods already accept `limit`; add an
  optional `offset` param (default 0) to each so the repository can page. Small,
  backward-compatible.
- **Demo mode:** `loadInsightsHistory` returns the seed/demo entries already in
  the store (the local seed spans enough days for a believable demo); no network.

### 4. Store slice
- **`src/store/useAppStore.ts`** — add:
  - `insightsEntries: Entry[]` (default `[]`), `insightsLoaded: boolean`,
    `insightsLoading: boolean`.
  - `loadInsights()` action: **lazy**, called on first Insights-tab focus. Guards
    on `insightsLoaded`/`insightsLoading`, calls `loadInsightsHistory(conn,
    selectedChildId, now - 90d)`, stores the result. On failure sets an error
    flag and leaves the tab in a retryable empty state (no crash).
  - Reset `insightsLoaded=false` when `selectedChildId` changes (child switch
    must reload). Cheapest: clear it in the existing child-select action.
- The 50-entry dashboard load is untouched; Insights history is additive and
  loaded on demand.

### 5. Pure computation — `src/features/insights/compute.ts` (new)
No React, no I/O. All functions take `Entry[]` + `now` (+ birth date where age
matters) and return plain data the components render. Mirrors the existing
`selectors.ts` / `groupByDay.ts` "pure logic, separately tested" pattern.

```ts
// Heatmap: one row per noon-to-noon day, sleep split into drawable segments.
export interface HeatSegment { x0: number; x1: number; nap: boolean } // x in [0,1), noon-origin
export interface HeatRow { dayLabel?: string; segments: HeatSegment[] }
export function buildSleepHeatmap(entries: Entry[], now: number, days = 28): HeatRow[];

// Daily/rolling trend series for a given metric + range.
export type TrendMetric =
  | 'totalSleep' | 'longestStretch' | 'wakeWindow'
  | 'feedsPerDay' | 'feedInterval' | 'diapers';
export interface TrendPoint { t: number; value: number }        // t = day (local midnight)
export function buildTrend(entries: Entry[], metric: TrendMetric, now: number, rangeDays: number): TrendPoint[];

// Diapers is special: two independent series (never summed — see below).
export interface DiaperDay { t: number; wet: number; dirty: number }
export function buildDiaperSeries(entries: Entry[], now: number, rangeDays: number): DiaperDay[];
```

Key computation notes:
- **Noon-to-noon bucketing** for both the heatmap rows and "per night" metrics
  (longest stretch). A sleep is assigned to the noon-to-noon window it starts in.
- **`buildSleepHeatmap`** maps each sleep interval's clock hours to a noon-origin
  position `((h - 12 + 24) mod 24) / 24`; splits the rare interval that crosses
  clock-noon into two segments; carries `nap` from the entry.
- **Wet vs dirty are two independent counts** — a diaper that is *both* wet and
  dirty is `+1 wet` **and** `+1 dirty` (each series counts each event once). We
  **never present the sum**, which would double-count the overlap. This is the
  resolved answer to "why does Baby Buddy count a both-diaper as two?": it's two
  health signals; we show two honest series, not one ambiguous total.
- **Wake window** = awake gap between consecutive sleeps within a day, averaged
  per day.
- All functions are ongoing-entry-safe (skip or clamp entries with `end == null`).

### 6. Reference data — `src/features/insights/norms.ts` (new)
Static, tiny, cited. Age-bucketed ranges + a confidence flag + source string.

```ts
export interface NormBucket { maxAgeDays: number; lo: number; hi: number }
export interface Norm {
  metric: TrendMetric;
  kind: 'band' | 'floor' | 'ruleOfThumb' | 'none';
  unit: string;
  buckets: NormBucket[];      // 'floor' uses lo only
  source: string;             // shown in the ⓘ sheet
  disclaimer: string;         // shared "general guidance…" line
}
export const NORMS: Record<TrendMetric, Norm>;
// Given a chart's time span + birth date, produce the per-point band arrays
// (stepped as the baby crosses bucket boundaries).
export function bandForRange(norm: Norm, birthMs: number, points: TrendPoint[]): { lo: number[]; hi: number[] } | null;
```

Values (documented with citations inline in the file): total sleep/day and
feeds/day as **band**; wet diapers as **floor** (≥6/day after the newborn
period); wake window + longest stretch as **ruleOfThumb**; dirty diapers `none`.

### 7. Chart components — `src/features/insights/`
Each is a small `react-native-svg` component; presentational, fed pre-computed
data from §5/§6. Theme-aware via `useTheme`.

- **`SleepHeatmap.tsx`** — renders `HeatRow[]`: per-row awake track + night/nap
  rounded rects, the noon-centred hour gridlines/labels, sparse day labels, and
  the Night/Nap legend. Width is responsive (measure container; the grid scales).
- **`TrendChart.tsx`** — the reusable banded chart: numbered y-axis + gridlines,
  dated x-axis, the normative band polygon (solid or dashed-rule variant),
  the data line + end dot. Props: `points`, `band`, `yTicks`, `color`,
  `bandKind`. The "typical" band label dodges the data line (corner placement).
- **`TrendCard.tsx`** — the card chrome around `TrendChart`: dot+label, current
  value+unit, delta pill (good/neutral), the "Typical at N mo · lo–hi" caption,
  and the ⓘ that opens a small sheet with `source` + `disclaimer`.
- **`DiaperBars.tsx`** — grouped **double bars** (wet beside dirty, per day) with
  a wet/dirty legend and a baseline axis. Uses the floor reference line for wet.

### 8. Screen composition — `insights.tsx`
- On mount/focus: `loadInsights()` (lazy).
- Header (phone): "Insights" + avatar → switcher (mirrors `growth.tsx`).
- Range selector (segmented `2 weeks / 1 month / 3 months`, local component
  state) + "Applies to trend charts" caption.
- `SLEEP` section: `SleepHeatmap` (fixed 28d) → TrendCards for totalSleep,
  longestStretch, wakeWindow (range-driven).
- `FEEDING` section: feedsPerDay, feedInterval.
- `DIAPERS` section: `DiaperBars`.
- **Empty / low-data states** (see below) replace individual cards when a metric
  lacks enough data.

### 9. Theme / colour
- Reuse `t.activity.sleep` for **night**; derive **nap** as a lighter tint
  (existing `hexA` / a lighten helper) so it tracks the theme. Feeding cards use
  `t.activity.feeding`. Diaper wet/dirty use a blue + brown pair — add two tokens
  (`insightWet`, `insightDirty`) to `tokens.ts` for both themes, plus band-fill
  tints, rather than hard-coding hex in components.

### 10. Tests (vitest, matching existing pure-logic tests)
- **`src/features/insights/compute.test.ts`** — heatmap segment mapping
  (noon-origin, midnight-centred, noon-seam split, nap flag), noon-to-noon
  bucketing, longest-stretch per night, wake-window averaging, feeds/day,
  interval, and the **wet/dirty double-count rule** (a both-diaper → +1 each,
  never summed). Ongoing-entry (`end: null`) handling.
- **`src/features/insights/norms.test.ts`** — `bandForRange` steps at bucket
  boundaries given a birth date; floor/none kinds behave; unknown ages clamp to
  the nearest bucket.
- **`src/data/repository`** — `loadInsightsHistory` pages until the cutoff and
  trims; demo mode returns local entries; a first-page failure degrades that
  type to `[]`, and a later-page failure keeps the pages already fetched
  (newest-first, so only the oldest end of the range is truncated)
  (matching `loadFromServer`'s `.catch(() => [])`).
- **`src/shell/labels.test.ts`** — `/insights` title.
- Chart components are visual; covered by manual verification, not snapshot pixel
  tests.

## Data flow

```
open Insights tab (first time this session / after child switch)
  -> insights.tsx focus -> loadInsights()
       guard insightsLoaded/insightsLoading
       real server:  loadInsightsHistory(conn, childId, now-90d)
                       -> client.listSleep/Feedings/Changes(childId, limit, offset) paged to cutoff
       demo:         local seed entries
     -> store.insightsEntries = entries; insightsLoaded = true

render
  compute (pure, memoised on entries + range):
    buildSleepHeatmap(entries, now, 28)          -> SleepHeatmap
    buildTrend(entries, metric, now, rangeDays)  -> TrendChart (x6)
    buildDiaperSeries(entries, now, rangeDays)   -> DiaperBars
  norms (pure, memoised on entries + birth):
    bandForRange(NORMS[metric], child.birth, points) -> band overlay

change range selector -> recompute trends only (heatmap fixed)
switch child           -> insightsLoaded=false -> reload on next focus
```

## Constraints (accepted)

- **Deeper fetch cost.** ≈90 days of sleep+feeds+diapers is more rows than the
  dashboard's 50/type. Mitigated by (a) loading **lazily** on first tab open, not
  at startup, and (b) fetching only the three charted types. Paginated, bounded
  by the 90-day cutoff.
- **Sparse early data.** A brand-new baby / freshly-connected server has little
  history. The tab must degrade gracefully per-section, not show broken axes
  (see below), and never imply a rhythm exists when there's a day of data.
- **Normative bands are population ranges**, deliberately wide and framed as
  "typical," not diagnostic. Rules-of-thumb are visually downgraded.
- **Time zones / DST:** all bucketing is local-time (matching the rest of the
  app's `new Date(ms)` usage). A DST-shifted day is off by an hour in the heatmap
  — accepted, negligible.

## Error handling & empty states

- **No connection / demo:** demo entries drive a fully-populated example tab.
- **Load failure:** `loadInsights` sets an error flag; the tab shows a friendly
  retry state (reuse the Growth empty-state visual language), no crash. Per-type
  fetch failures degrade per type: a first-page failure yields `[]` for that
  type; a later-page failure keeps the already-fetched newest pages, so that
  type's charts render a correct but shorter recent history (user decision:
  partial recent data beats dropping the type).
- **Low data per metric:** each metric needs a minimum (e.g. **≥7 days** with
  sleep data for the heatmap to render, **≥3 points** for a trend line). Below
  that, the card shows a "Keep logging — your <metric> curve appears after a few
  days" placeholder instead of a misleading 2-point chart. The heatmap shows only
  the days that exist (never pads phantom empty rows to 28).
- **Ongoing entries** (running timer, `end: null`) are excluded from completed
  aggregates and from the heatmap (or clamped to `now` for today's row only).

## Testing

- Unit (vitest): the pure `compute` + `norms` modules and `loadInsightsHistory`
  paging, per §10 — the analytical correctness lives here.
- Manual verification (real server + demo):
  - Heatmap reads correctly — night block centred, naps lilac, rhythm visible
    across weeks; today's partial row looks right.
  - Range selector reshapes the trend charts but **not** the heatmap.
  - A banded card shows the stepped age band and the ⓘ source/disclaimer sheet.
  - Diapers render as grouped double bars; a both-wet-and-dirty change increments
    both bars and is never summed.
  - Child switch reloads history; low-data child shows placeholders, not broken
    charts.
  - Desktop shell: Insights appears in the sidebar, title bar reads "Insights",
    bottom tab hidden; phone: 5th tab present and navigable.
