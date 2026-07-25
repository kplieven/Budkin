# WHO growth-standard percentile curves on the metric charts

**Date:** 2026-07-25
**Status:** Approved, ready for planning

## Problem

Each growth metric (weight, height, head circumference, BMI) now has a
per-metric detail screen with a progression curve (`src/app/metric/[kind].tsx`,
shipped by the 2026-07-06 growth spec). The curve shows how the child is
tracking against *themselves*, but not against anything external. A parent
cannot tell whether a given weight is typical for a child of that age and sex.
The child's sex is now recorded (`gender`, shipped 2026-07-24), so the reference
a clinician would reach for, the WHO growth standards, can finally be drawn.

The earlier growth spec explicitly deferred this as v2: "No WHO / percentile
bands... it needs growth-standard (LMS) reference data, a materially larger,
separate follow-up. `TrendChart` already supports a band, so v2 can add it."
This is that follow-up.

## Goal

When a child's gender is recorded as `girl` or `boy`, overlay the WHO
growth-standard percentile curves for the metric behind the child's own line on
the metric detail chart, so the two can be compared. The overlay is on by
default and can be toggled off.

## Non-goals

- **No overlay on the Growth-tab sparklines.** The tiny overview sparklines stay
  chrome-free; the reference only appears on the large detail chart.
- **No reference beyond 5 years.** WHO Child Growth Standards run 0 to 60
  months. Past that no curve is drawn (the WHO 2007 5-to-19y reference is a
  separate dataset and out of scope).
- **No numeric "your baby is at the Nth percentile" readout.** v1 is visual
  comparison only. The LMS data makes an exact-percentile label easy later, but
  it is not part of this work.
- **No reference for gender `other` or unrecorded.** WHO defines girl and boy
  standards only (see Decisions).
- **No new server reads/writes.** The reference data is a static local table;
  gender and measurements are already in the store.

## Decisions (resolved during brainstorming)

### Reference standard: WHO Child Growth Standards (0 to 60 months)
Matches how the app already cites WHO (the Insights sleep norm) and is the
standard used across Europe for under-fives. All four Budkin metrics map to a
published WHO indicator, split by sex:

| Budkin `kind` | WHO indicator | Notes |
| --- | --- | --- |
| `weight` | Weight-for-age | 0 to 60 months |
| `height` | Length/height-for-age | Recumbent length 0 to 24mo, standing height 24 to 60mo, in one continuous WHO table |
| `head` | Head-circumference-for-age | 0 to 60 months |
| `bmi` | BMI-for-age | 0 to 60 months |

### Chart style: full clinical curves, five percentile lines (chosen in the visual companion over "shaded band only" and "band + median")
Five lines per chart at the 3rd, 15th, 50th, 85th and 97th percentiles, no fill.
The 50th is drawn slightly bolder; the other four are lighter. Percentiles are
labelled at the right edge (`3 / 15 / 50 / 85 / 97`) rather than in a legend box.
This is the familiar paper-chart look the user preferred over the calmer
band styles.

### Colour: theme neutrals for the reference, the metric colour for the child
The child's own line keeps its metric colour (e.g. weight gold `#C9A227`) and the
five reference lines use theme neutral greys (`t.dim` for the emphasised 50th,
`t.faint` for the rest), so the child's line always reads as the foreground and
the whole thing adapts to light and dark. (The companion mockups used a fixed
slate to stand in for these neutrals.)

### Gender `other` / unrecorded: no curves
WHO defines girl and boy references only. For a child recorded as `other`, draw
no curves and show a one-line caption: "WHO growth curves compare girls and boys
only." For an unrecorded gender, show nothing at all (no curve, no caption): the
feature is scoped to "if the gender is chosen".

### Visibility: on by default, with a toggle to hide
A "WHO reference" toggle chip sits above the chart whenever a reference is
available. It defaults on and is a global, persisted preference
(`showGrowthReference`), the same kind of display lens as metric/imperial units.
Turning it off leaves just the child's line. The chip is not shown when no
reference is available (wrong gender, unsupported metric, or age fully out of
range).

### Source + disclaimer: reuse the Insights norms pattern
Show a tappable "WHO Child Growth Standards" source link and the same medical
disclaimer copy the Insights norms already use (`DISCLAIMER` in
`src/features/insights/norms.ts`), so the medical framing is consistent across
the app.

## Architecture

### New / changed files

| File | Change |
| --- | --- |
| `src/features/measurements/whoLms.ts` | **New.** Static WHO LMS tables: per metric, per sex, monthly `{ L, M, S }` for ages 0 to 60 months. Data only. |
| `src/features/measurements/whoReference.ts` | **New.** Pure logic: percentile-from-LMS, and `referenceCurves(...)` that samples the curves across the chart's visible age range in display units. |
| `src/features/measurements/whoReference.test.ts` | **New.** TDD: LMS spot-checks against WHO published percentile values, plus availability/clamping/unit-conversion. |
| `src/features/insights/TrendChart.tsx` | Additive `curves` prop (an array of labelled polylines drawn in `time` mode) plus right-edge percentile labels. Insights behaviour unchanged. |
| `src/features/measurements/growthChart.ts` | `yTicksFor(points, extraValues?)` gains an optional second arg so the y-axis can also span the reference values. Existing single-arg callers unaffected. |
| `src/data/prefs.ts` | Add `showGrowthReference: boolean` to `Prefs`. |
| `src/store/useAppStore.ts` | Add `showGrowthReference` state (default `true`), a `setGrowthReference(on)` action mirroring `setRhythmLayer` (persist via `savePrefs`), and load it in `hydrate`. |
| `src/app/metric/[kind].tsx` | Compute the reference, pass `curves` to `TrendChart`, widen the y-axis with the reference values, render the toggle chip, the source/disclaimer line, and the `other`-gender caption. |

### `whoLms.ts` (data)

```ts
export type Sex = 'girl' | 'boy';
export interface Lms { L: number; M: number; S: number }
// Index i is completed age in months, 0..60. M is in metric units
// (kg for weight, cm for height/head, kg/m^2 for BMI).
export type LmsTable = Lms[]; // length 61
export const WHO_LMS: Record<MeasurementKind, Record<Sex, LmsTable>>;
```

Roughly 4 metrics x 2 sexes x 61 months x 3 numbers, a few hundred lines of
constants. Monthly granularity is enough for a smooth rendered curve; the by-week
WHO tables for the first weeks are not needed for v1.

### `whoReference.ts` (logic, pure and tested)

```ts
// z-scores of the target percentiles (standard-normal quantiles)
const PCTS = [
  { p: 3,  z: -1.88079, emphasis: false },
  { p: 15, z: -1.03643, emphasis: false },
  { p: 50, z:  0,       emphasis: true  },
  { p: 85, z:  1.03643, emphasis: false },
  { p: 97, z:  1.88079, emphasis: false },
];

// WHO LMS: X = M(1 + LSz)^(1/L) for L != 0, else M*exp(Sz)
function valueAtZ({ L, M, S }: Lms, z: number): number;

export interface GrowthCurve {
  p: number;              // percentile, for label + ordering
  label: string;          // "50"
  emphasis: boolean;      // true for the 50th
  points: { t: number; value: number }[]; // display units, along the time axis
}

// Returns null when no reference applies. Otherwise five curves sampled
// monthly across [tMin, tMax], clamped to ages [0, 60] months and converted
// to `unitSystem`.
export function referenceCurves(
  kind: MeasurementKind,
  gender: ChildGender | undefined,
  birthMs: number,
  tMin: number, tMax: number,
  unitSystem: UnitSystem,
): GrowthCurve[] | null;

// True when the visible time range covers any age in [0, 60] months. Used by
// the screen to gate the `other`-gender caption (where `referenceCurves`
// returns null but we still want to explain why), so both agree on "in range".
export function hasWhoAgeOverlap(birthMs: number, tMin: number, tMax: number): boolean;
```

Sampling: age in months is `(t - birthMs) / MONTH_MS` with
`MONTH_MS = 30.4375 * 86400000` (365.25/12 days). Sample at both endpoints
(`tMin`, `tMax`) and every whole-month timestamp strictly between them. For each
sample, look up the bounding integer-month LMS rows and linearly interpolate
`L`, `M`, `S` for a fractional age, compute each percentile value, then
`toDisplay(kind, value, unitSystem)`.

Clamping and availability:
- `gender` not `girl`/`boy` -> `null`.
- If the visible age range does not intersect `[0, 60]` months -> `null`.
- If it partly exceeds 60 months, stop the curves at the timestamp for age 60
  (`birthMs + 60 * MONTH_MS`) so they end mid-plot rather than extrapolating.
- Ages below 0 (a measurement dated before birth, edge case) clamp to month 0.

### `TrendChart` change (additive, non-breaking)

Add an optional `curves?: GrowthCurve[]` prop, meaningful only in
`xMode === 'time'`. Rendered after the gridlines and before the child's line
(so the child's line sits on top), using the existing `xAtT(t)` and `yv(value)`
mappers. The emphasised (50th) curve draws at `strokeWidth` ~1.6 in `t.dim`; the
others at ~1.1 in `t.faint`. After the axis labels, draw each curve's `label` at
the right edge (`x = gx + gw + 3`, `y` at the curve's last point) in `t.faint`.
Insights callers pass no `curves` and are unchanged.

### `yTicksFor` change

`yTicksFor(points, extraValues?)`: when `extraValues` is passed, fold them into
the min/max before choosing nice ticks, so the visible portion of the 3rd and
97th curves is never clipped. The metric screen passes the flattened reference
`value`s. Called without the second arg, behaviour is identical to today.

### Store + prefs

Mirror the existing `setRhythmLayer` precedent exactly:
- `Prefs` gains `showGrowthReference: boolean`.
- Store state `showGrowthReference: true` by default.
- `setGrowthReference(on)` sets state and `void savePrefs({ showGrowthReference: on })`.
- `hydrate` applies `if (prefs.showGrowthReference != null) set({ showGrowthReference: prefs.showGrowthReference })`
  (a `!= null` guard, not truthy, so a stored `false` is honoured).

## Metric screen wiring (`metric/[kind].tsx`)

The screen already builds `points` (display units) and `{ ticks, fmtY }` for the
chart. Add, right after:

```ts
const showRef = useAppStore((s) => s.showGrowthReference);
const setRef  = useAppStore((s) => s.setGrowthReference);
const tMin = points.length ? points[0].t : 0;
const tMax = points.length ? points[points.length - 1].t : 0;
const overlap = !!child && points.length >= 2 && hasWhoAgeOverlap(child.birth, tMin, tMax);
const isSexed = child?.gender === 'girl' || child?.gender === 'boy';
const refAll = overlap && isSexed
  ? referenceCurves(kind, child!.gender, child!.birth, tMin, tMax, unitSystem)
  : null;                                  // reference available to toggle?
const curves = showRef ? refAll : null;    // available but toggled off => hidden
const refValues = curves?.flatMap((c) => c.points.map((p) => p.value)) ?? [];
const { ticks, fmtY } = yTicksFor(points, refValues);
```

Then:
- **Toggle chip** above the chart card, shown when `refAll` is non-null (a
  reference exists to show). Tapping calls `setRef(!showRef)`. Styled like the
  existing small pill chips; reflects on/off.
- **`<TrendChart ... curves={curves} />`** (was `band={null}`; `band` stays
  `null`, this is the new prop).
- **Source + disclaimer line** under the chart, shown when `curves` is non-null
  (reference exists *and* the toggle is on, so it never dangles under a hidden
  overlay): a tappable "WHO Child Growth Standards" link
  (`https://www.who.int/tools/child-growth-standards/standards`) and the shared
  `DISCLAIMER` copy.
- **`other`-gender caption**: when `child?.gender === 'other' && overlap`, show
  "WHO growth curves compare girls and boys only." This is the one case where a
  reference would apply by age but not by sex, so we explain the absence rather
  than the chip.

## Availability matrix

A reference is *available* when **all** hold: gender is `girl` or `boy`; `kind`
is one of the four (all supported); `points.length >= 2`; and the visible age
range intersects `[0, 60]` months (`refAll != null`). When available, the **chip**
always shows; the **curves + source line** show only while the toggle is on. The
**caption** is the sex-only miss: same conditions but gender `other`.

| gender | curves | chip | caption |
| --- | --- | --- | --- |
| girl / boy, in range, toggle on | yes | yes (on) | no |
| girl / boy, in range, toggle off | no | yes (off) | no |
| girl / boy, age fully > 60mo | no | no | no |
| other | no | no | yes |
| unrecorded | no | no | no |
| < 2 points (any gender) | no | no | no |

## Data provenance and accuracy

This is the central risk: the numbers must be right. The `whoLms.ts` constants
are transcribed from WHO's official expanded LMS tables (the per-indicator,
per-sex, by-month files published under the WHO Child Growth Standards). The
accuracy gate is a test, not a code review:

- For a spread of ages and both sexes, recompute the 3rd/50th/97th percentile
  from the embedded LMS via `valueAtZ` and assert they match WHO's *own*
  published percentile tables (a different WHO file than the LMS source) within a
  small tolerance (0.05 kg / 0.1 cm). If the LMS was transcribed wrong, this
  fails.
- Include at least the birth (month 0) and 12-, 24-, 60-month rows for each
  metric and sex among the checks.

## Testing

`whoReference.test.ts` (vitest, matching the repo's pure-logic tests):
- `valueAtZ` handles `L = 0` (BMI rows can be near zero) via the `exp` branch and
  `L != 0` via the power branch.
- Percentile spot-checks against WHO published values (the accuracy gate above).
- `referenceCurves` returns `null` for `other` and `undefined` gender.
- Returns `null` when the age range is entirely past 60 months; clamps the last
  sample to age 60 when the range straddles it.
- Converts to imperial when `unitSystem === 'imperial'` (e.g. weight in lb).
- Samples span exactly `[tMin, tMax]` (endpoints included).

`growthChart.test.ts` (extend):
- `yTicksFor(points, extra)` widens the range to include `extra`; called without
  `extra` it is byte-for-byte the old behaviour.

Store test (extend `useAppStore.test.ts`):
- `setGrowthReference(false)` flips state and persists; default is `true`;
  `hydrate` restores a stored `false`.

Manual / `/verify`: on a child set to `girl`, open weight detail with 2+ logs and
see five labelled curves behind the line; toggle the chip off and they vanish and
the y-axis relaxes; switch the child to `boy` and the curves shift; set `other`
and see the caption instead; a child with no gender shows neither; confirm light
and dark both read well; desktop renders inside the shell.

## Scope / decomposition

One cohesive feature along a single data path (LMS table -> `referenceCurves` ->
`TrendChart` curves), plus a small persisted toggle that reuses the existing
prefs machinery. Ships as one spec -> plan. The bulk of the effort is
transcribing and verifying the WHO LMS data, which the accuracy test gates.
```
