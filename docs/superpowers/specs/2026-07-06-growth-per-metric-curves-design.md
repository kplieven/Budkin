# Growth tab — per-metric progression curves + per-metric history

**Date:** 2026-07-06
**Status:** Approved, ready for planning

## Problem

The Growth tab (`src/app/(tabs)/growth.tsx`) shows each metric's *latest value*
in a 2×2 card grid and, below it, a single **"Recent"** list that mixes every
metric's measurements together in reverse-chronological order. A parent cannot:

1. **See the progression of a metric as a curve** — whether weight is tracking
   up steadily, whether height has stalled. The trend is invisible; only the
   most recent number shows.
2. **Read the history of one metric on its own** — the mixed list interleaves
   weight, height, head and BMI, so following a single metric means scanning
   past the others.

## Goal

Turn Growth into an overview-plus-detail structure:

- Each of the four overview cards gains a **mini sparkline** of that metric's
  series, so the progression of all four is visible at a glance.
- Tapping a card with data opens a **per-metric detail screen** showing a large
  **progression curve**, the current value with a change indicator, and **that
  metric's own history** (newest first), plus an Add button.

This answers both asks — "progression on a curve" (sparkline on every card +
the big curve) and "history per metric, not all mixed" (history is scoped inside
each metric's detail screen).

## Non-goals (v1)

- **No WHO / percentile "typical for age" bands** behind the curve. Wanted
  eventually, but it needs growth-standard (LMS) reference data — a materially
  larger, separate follow-up. `TrendChart` already supports a `band`, so v2 can
  add it without reworking v1.
- **No time-range toggles** (3m / 1y / all). v1 plots all history.
- **No new logging UI.** Adding and editing reuse the existing
  `MeasurementSheet` unchanged.
- **No x-axis by child's age.** v1 plots against calendar date; age-based x is a
  possible later refinement.
- **No new server reads/writes.** The store already holds `measurements`.

## Decisions (resolved during brainstorming)

### Layout — overview + detail screen (chosen over segmented tabs / inline stack)
The overview's all-four-at-a-glance value is worth keeping for a low-frequency,
glance-first screen; a segmented control would show only one metric at a time,
and an inline stack forces every metric's history behind a "see all" anyway. So:
enrich the overview cards with sparklines, and push into a detail screen per
metric.

### Navigation — a new top-level route, mirroring Settings
`Settings` is the template: a full screen that lives **outside** the `(tabs)`
group, registered in the root `Stack`, reached via `router.push('/settings')`,
rendering its own header+back on phone while the persistent `DesktopShell`
(sidebar/top bar) wraps it on desktop.

The detail screen follows the same recipe: **`src/app/metric/[kind].tsx`**,
registered as `<Stack.Screen name="metric/[kind]" />` in `src/app/_layout.tsx`
(sibling of `settings`). Reached via `router.push('/metric/weight')`. Using
`metric/[kind]` rather than `growth/[kind]` avoids any route ambiguity with the
existing `(tabs)/growth` → `/growth` tab route.

### Tap behavior on the overview
- Card **with data** → `router.push('/metric/<kind>')` (detail screen).
- Card **without data** → keeps today's behavior: opens the add sheet directly
  via `openMeasurement(kind)`, so the first-ever log stays a single tap.

### Remove the mixed "Recent" list
The overview's flat, all-metrics "Recent" section is **removed**. History now
lives per-metric in each detail screen.

## Architecture

### New / changed files

| File | Change |
| --- | --- |
| `src/app/metric/[kind].tsx` | **New.** The per-metric detail screen. |
| `src/app/_layout.tsx` | Register `<Stack.Screen name="metric/[kind]" />`. |
| `src/app/(tabs)/growth.tsx` | Add sparkline to cards; card tap → detail (data) or add sheet (empty); remove the mixed "Recent" list. |
| `src/features/measurements/growthChart.ts` | **New.** Pure helpers: per-kind series, y-ticks + `fmtY`, x-extent, change-since-previous delta. |
| `src/features/measurements/growthChart.test.ts` | **New.** Unit tests for the helpers (TDD). |
| `src/features/measurements/Sparkline.tsx` | **New.** Chrome-free mini line chart for the overview cards. |
| `src/features/insights/TrendChart.tsx` | Additive props: `xMode?: 'index' \| 'time'` (default `'index'`), `xStartLabel`/`xEndLabel`. Insights behavior unchanged. |

### `growthChart.ts` (pure, testable)

The single source of chart geometry, consumed by both the sparkline and the big
chart so they never diverge.

- `seriesFor(measurements, kind): TrendPoint[]` — filter to `kind`, sort
  **ascending by date**, map to `{ t: date, value }`. (`TrendPoint` is reused
  from `insights/compute.ts`: `{ t: number; value: number }`.)
- `yTicksFor(points): { ticks: number[]; fmtY: (v: number) => string }` — nice
  rounded ticks spanning the data with a little headroom; `fmtY` formats to a
  sensible precision per metric.
- `changeSince(points): { delta: number; since: number } | null` — last value
  minus previous, with the previous point's date, for the detail header
  (`null` when < 2 points).

### `Sparkline.tsx`
A minimal `react-native-svg` line: the path + an end dot, no axes, ticks or
labels, fixed small height (~28px), width from the card. Kept separate rather
than adding a "mini mode" to `TrendChart` because the chrome needs differ
entirely. Renders nothing for < 2 points.

### `TrendChart` change (additive, non-breaking)
Today x is `i / (points.length - 1)` (even index spacing) and the x-labels are
hardcoded `start` / `Today`. Add:
- `xMode: 'index' | 'time'` — in `'time'` mode, x maps by
  `(p.t - tMin) / (tMax - tMin)` so irregular gaps between growth entries read
  truthfully. Default `'index'` leaves Insights untouched.
- `xStartLabel` / `xEndLabel` — default to `start` / `Today`; the detail screen
  passes the first measurement's date and `Today`.

## Detail screen layout (`metric/[kind].tsx`)

Top → bottom:

1. **Header** — `‹` back (`router.back()`), metric label, child avatar
   (`openSwitcher`), mirroring the Growth tab header. Phone: own header + safe
   area. Desktop: `DesktopPage` (maxWidth ~640), chrome from `DesktopShell`.
2. **Value + change** — big current value with unit, and
   `changeSince(...)` rendered as e.g. "▲ +0.3 kg since Jun 15" (reusing the
   `TrendCard` delta pill styling).
3. **Curve** — `TrendChart` with `xMode="time"`, the metric's color,
   `yTicksFor(...)`, `xStartLabel`/`xEndLabel`.
4. **History** — that metric's entries newest-first, reusing the existing row
   styling from `growth.tsx`. Tapping a row opens the edit sheet
   (`openEditMeasurement(id)`).
5. **"+ Add \<metric\>"** — opens `MeasurementSheet` (`openMeasurement(kind)`).

`kind` comes from `useLocalSearchParams`; guard against an invalid value (not in
`MEAS_KINDS`) with a `<Redirect href="/(tabs)/growth" />`.

## States

- **0 points** — detail shows an empty state + Add. (Reached mainly via deep
  link/edit-delete, since a 0-data overview card opens the add sheet directly.)
- **1 point** — value + a single history row + "Add another to see a trend"; no
  line drawn. `TrendChart` already handles `points.length <= 1` (dot at x=0.5),
  and `Sparkline` renders nothing.
- **≥ 2 points** — full curve + change indicator.

## Data flow

`useAppStore.measurements` → `seriesFor(measurements, kind)` →
`yTicksFor`/`changeSince` → `TrendChart` / `Sparkline`. Read-only; add/edit go
through the existing store actions (`openMeasurement`, `openEditMeasurement`,
`saveMeasurement`, `deleteMeasurement`) and their existing server sync. No store
shape changes.

## Testing

- `growthChart.test.ts` (vitest, matching the repo's existing pure-logic tests):
  - `seriesFor` filters by kind, sorts ascending, ignores other kinds.
  - `yTicksFor` produces ascending ticks spanning the data with headroom;
    `fmtY` precision per metric; degenerate all-equal-values range doesn't divide
    by zero.
  - `changeSince` returns last−previous with the previous date; `null` for < 2
    points.
- Manual/`/verify`: overview sparklines render; tapping a card with data pushes
  the detail screen; empty card opens the add sheet; back returns to Growth;
  add/edit/delete round-trip and the curve + history update; desktop renders
  inside the shell.

## Scope / decomposition

One cohesive feature — the detail screen delivers **both** the curve and the
per-metric history, and the sparkline is a small overview enhancement of the same
data path. Ships as a single spec → plan, not split into parallel work.
