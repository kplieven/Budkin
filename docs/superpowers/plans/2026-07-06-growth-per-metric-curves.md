# Growth per-metric curves + history — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Growth tab a per-metric progression curve and per-metric history: sparklines on the overview cards, and a new detail screen (large curve + that metric's own history + Add) reached by tapping a card.

**Architecture:** A new pure helper (`growthChart.ts`) turns the store's `measurements` into chart series, dynamic y-ticks, and a change delta. A new detail route `src/app/metric/[kind].tsx` (sibling of `settings`, outside `(tabs)`) renders the big curve via the existing `TrendChart` (extended additively with a time-proportional x-mode) plus the metric's history and an Add button. The overview cards move into a `MetricCard` component that draws a chrome-free `Sparkline`. No store shape changes; add/edit reuse the existing `MeasurementSheet`.

**Tech Stack:** Expo Router v56 (typed routes, file-based), React Native 0.85, `react-native-svg`, Zustand store, vitest for pure-logic tests.

## Global Constraints

- **Expo v56 — read the versioned docs before writing code:** https://docs.expo.dev/versions/v56.0.0/ (per `AGENTS.md`).
- **No new dependencies.** Reuse `react-native-svg`, existing components, existing store actions.
- **No store shape changes.** Read `useAppStore.measurements`; add/edit go through the existing `openMeasurement`, `openEditMeasurement`, `saveMeasurement`, `deleteMeasurement`.
- **`TrendChart` changes must be additive** — defaults preserve current Insights behavior exactly.
- **Typed routes are on** (`app.json` → `typedRoutes: true`). Use `router.push({ pathname: '/metric/[kind]', params: { kind } })` and typed `href`s.
- **UI copy: no em-dashes** (repo convention, see commit `4b7c562`). Plain hyphens or separate sentences.
- **Path alias:** import from `@/…` (maps to `src/`).
- **Tests:** vitest, files named `*.test.ts` under `src/` (not `.tsx`), `import { describe, expect, it } from 'vitest'`.

---

### Task 1: `growthChart.ts` pure helpers (TDD)

**Files:**
- Create: `src/features/measurements/growthChart.ts`
- Test: `src/features/measurements/growthChart.test.ts`

**Interfaces:**
- Consumes: `Measurement`, `MeasurementKind` from `@/types/models`; `TrendPoint` (`{ t: number; value: number }`) from `@/features/insights/compute`.
- Produces:
  - `seriesFor(measurements: Measurement[], kind: MeasurementKind): TrendPoint[]` — filtered to `kind`, sorted ascending by date.
  - `yTicksFor(points: TrendPoint[]): { ticks: number[]; fmtY: (v: number) => string }` — ascending "nice" ticks spanning the data with headroom.
  - `changeSince(points: TrendPoint[]): { delta: number; sinceT: number } | null` — last value minus previous, previous point's date; `null` for < 2 points.

- [ ] **Step 1: Write the failing test**

Create `src/features/measurements/growthChart.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { changeSince, seriesFor, yTicksFor } from './growthChart';
import type { Measurement } from '@/types/models';

const DAY = 86400000;
const base = new Date(2026, 0, 1).getTime();
const m = (kind: Measurement['kind'], value: number, dayOffset: number): Measurement => ({
  id: `${kind}-${dayOffset}`,
  childId: 'c1',
  kind,
  value,
  date: base + dayOffset * DAY,
});

describe('seriesFor', () => {
  it('filters by kind and sorts ascending by date', () => {
    const data = [m('weight', 7.0, 30), m('height', 60, 10), m('weight', 6.5, 15), m('weight', 5.0, 1)];
    const s = seriesFor(data, 'weight');
    expect(s.map((p) => p.value)).toEqual([5.0, 6.5, 7.0]);
    expect(s.map((p) => p.t)).toEqual([base + DAY, base + 15 * DAY, base + 30 * DAY]);
  });

  it('returns an empty array when no measurement matches the kind', () => {
    expect(seriesFor([m('weight', 5, 1)], 'bmi')).toEqual([]);
  });
});

describe('yTicksFor', () => {
  it('produces ascending ticks that span the data', () => {
    const { ticks } = yTicksFor([{ t: 1, value: 3.4 }, { t: 2, value: 7.2 }]);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks[0]).toBeLessThanOrEqual(3.4);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(7.2);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
  });

  it('does not divide by zero for a flat series', () => {
    const { ticks } = yTicksFor([{ t: 1, value: 5 }, { t: 2, value: 5 }]);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks[0]).toBeLessThan(5);
    expect(ticks[ticks.length - 1]).toBeGreaterThan(5);
    expect(ticks.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('formats ticks with fmtY, trimming trailing zeros', () => {
    const { fmtY } = yTicksFor([{ t: 1, value: 3 }, { t: 2, value: 8 }]);
    expect(fmtY(3)).toBe('3');
    expect(fmtY(15.5)).toBe('15.5');
  });
});

describe('changeSince', () => {
  it('returns last minus previous with the previous date', () => {
    const r = changeSince([{ t: 10, value: 6.5 }, { t: 20, value: 7.0 }])!;
    expect(r.delta).toBeCloseTo(0.5, 6);
    expect(r.sinceT).toBe(10);
  });

  it('returns null for fewer than two points', () => {
    expect(changeSince([])).toBeNull();
    expect(changeSince([{ t: 1, value: 5 }])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- growthChart`
Expected: FAIL — `Cannot find module './growthChart'` / functions not defined.

- [ ] **Step 3: Write minimal implementation**

Create `src/features/measurements/growthChart.ts`:

```ts
import type { TrendPoint } from '@/features/insights/compute';
import type { Measurement, MeasurementKind } from '@/types/models';

/** Measurements of one kind, oldest first, as chart points. */
export function seriesFor(measurements: Measurement[], kind: MeasurementKind): TrendPoint[] {
  return measurements
    .filter((x) => x.kind === kind)
    .sort((a, b) => a.date - b.date)
    .map((x) => ({ t: x.date, value: x.value }));
}

/** Round a raw span up to a 1/2/5 x 10^n "nice" number. */
function niceNum(range: number, round: boolean): number {
  if (range <= 0) return 1;
  const exp = Math.floor(Math.log10(range));
  const frac = range / 10 ** exp;
  let nice: number;
  if (round) nice = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10;
  else nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return nice * 10 ** exp;
}

const fmtY = (v: number): string => {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

/** Ascending "nice" y-axis ticks spanning the data, with headroom. */
export function yTicksFor(points: TrendPoint[]): { ticks: number[]; fmtY: (v: number) => string } {
  const vals = points.map((p) => p.value);
  let lo = vals.length ? Math.min(...vals) : 0;
  let hi = vals.length ? Math.max(...vals) : 1;
  if (lo === hi) {
    const pad = Math.abs(lo) * 0.1 || 1;
    lo -= pad;
    hi += pad;
  }
  const step = niceNum(niceNum(hi - lo, false) / 4, true);
  const niceLo = Math.floor(lo / step) * step;
  const niceHi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = niceLo; v <= niceHi + step * 0.5; v += step) {
    ticks.push(Math.round(v * 1000) / 1000);
  }
  return { ticks, fmtY };
}

/** Change from the previous measurement to the latest, and the previous date. */
export function changeSince(points: TrendPoint[]): { delta: number; sinceT: number } | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  return { delta: last.value - prev.value, sinceT: prev.t };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- growthChart`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add src/features/measurements/growthChart.ts src/features/measurements/growthChart.test.ts
git commit -m "feat(growth): add growthChart series/tick/delta helpers"
```

---

### Task 2: Extend `TrendChart` with a time x-mode (additive)

**Files:**
- Modify: `src/features/insights/TrendChart.tsx`

**Interfaces:**
- Consumes: existing `TrendPoint[]` (assumed sorted ascending by `t` in time mode).
- Produces: new optional props on `TrendChart` — `xMode?: 'index' | 'time'` (default `'index'`), `xStartLabel?: string` (default `'start'`), `xEndLabel?: string` (default `'Today'`). Time mode maps x by timestamp so irregular gaps read truthfully.

- [ ] **Step 1: Update the component signature**

In `src/features/insights/TrendChart.tsx`, replace the props destructuring/type (lines 8-11) with:

```tsx
export function TrendChart({ points, band, color, ruleOfThumb, yTicks, fmtY, width, xMode = 'index', xStartLabel = 'start', xEndLabel = 'Today' }: {
  points: TrendPoint[]; band: Band | null; color: string; ruleOfThumb?: boolean;
  yTicks: number[]; fmtY: (v: number) => string; width: number;
  xMode?: 'index' | 'time'; xStartLabel?: string; xEndLabel?: string;
}) {
```

- [ ] **Step 2: Map x by time when requested**

Replace the `xv` definition (line 19) with a time-aware version:

```tsx
  const tMin = points.length ? points[0].t : 0;
  const tMax = points.length ? points[points.length - 1].t : 1;
  const xFrac = (i: number) => {
    if (points.length <= 1) return 0.5;
    if (xMode === 'time' && tMax > tMin) return (points[i].t - tMin) / (tMax - tMin);
    return i / (points.length - 1);
  };
  const xv = (i: number) => gx + xFrac(i) * gw;
```

- [ ] **Step 3: Use the label props**

Replace the two hardcoded axis labels (lines 47-48) with:

```tsx
      <SvgText x={gx} y={top + plotH + 14} fontSize={9.5} fontWeight="600" fill={t.faint} textAnchor="start">{xStartLabel}</SvgText>
      <SvgText x={gx + gw} y={top + plotH + 14} fontSize={9.5} fontWeight="600" fill={t.faint} textAnchor="end">{xEndLabel}</SvgText>
```

- [ ] **Step 4: Verify Insights is unchanged + types pass**

Run: `npx tsc --noEmit`
Expected: no new errors. The Insights tab passes none of the new props, so it keeps `xMode='index'` and `'start'/'Today'` labels — behavior identical.

Run: `npm test`
Expected: PASS (existing `norms`/`compute` tests still green; no behavior change).

- [ ] **Step 5: Commit**

```bash
git add src/features/insights/TrendChart.tsx
git commit -m "feat(insights): add optional time x-mode and axis labels to TrendChart"
```

---

### Task 3: `Sparkline` component

**Files:**
- Create: `src/features/measurements/Sparkline.tsx`

**Interfaces:**
- Consumes: `TrendPoint[]` from `@/features/insights/compute` (ascending by `t`).
- Produces: `Sparkline({ points, color, width, height? })` — a chrome-free line + end dot; renders `null` for `width <= 0` or `< 2` points.

- [ ] **Step 1: Write the component**

Create `src/features/measurements/Sparkline.tsx`:

```tsx
import Svg, { Circle, Path } from 'react-native-svg';

import type { TrendPoint } from '@/features/insights/compute';

/**
 * Minimal progression line for the Growth overview cards. No axes, ticks or
 * labels: just the curve and a dot on the latest point. Renders nothing until
 * there are at least two points and a measured width.
 */
export function Sparkline({ points, color, width, height = 30 }: {
  points: TrendPoint[]; color: string; width: number; height?: number;
}) {
  if (width <= 0 || points.length < 2) return null;
  const pad = 3;
  const tMin = points[0].t;
  const tMax = points[points.length - 1].t;
  const vals = points.map((p) => p.value);
  const vMin = Math.min(...vals);
  const vMax = Math.max(...vals);
  const tSpan = tMax - tMin;
  const vSpan = vMax - vMin;
  const xv = (p: TrendPoint) => pad + (tSpan > 0 ? (p.t - tMin) / tSpan : 0.5) * (width - pad * 2);
  const yv = (v: number) => pad + (vSpan > 0 ? 1 - (v - vMin) / vSpan : 0.5) * (height - pad * 2);
  const d = points.map((p, i) => `${i ? 'L' : 'M'} ${xv(p).toFixed(1)} ${yv(p.value).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  return (
    <Svg width={width} height={height}>
      <Path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={xv(last)} cy={yv(last.value)} r={2.6} fill={color} />
    </Svg>
  );
}
```

- [ ] **Step 2: Verify types pass**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/measurements/Sparkline.tsx
git commit -m "feat(growth): add chrome-free Sparkline for metric cards"
```

---

### Task 4: `MetricCard` component

**Files:**
- Create: `src/features/measurements/MetricCard.tsx`

**Interfaces:**
- Consumes: `seriesFor` output (`TrendPoint[]`), `Sparkline`, `MEAS_META`.
- Produces: `MetricCard({ kind, points, onPress })` — one overview card showing the metric label, latest value, a sparkline (only when `>= 2` points), and the latest date, or a "+ Tap to add" empty state.

- [ ] **Step 1: Write the component**

Create `src/features/measurements/MetricCard.tsx`:

```tsx
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { isHovered } from '@/components/hover';
import { Txt } from '@/components/Txt';
import type { TrendPoint } from '@/features/insights/compute';
import { hexA } from '@/lib/color';
import { MEAS_META } from '@/lib/measurements';
import { useTheme } from '@/theme/useTheme';
import type { MeasurementKind } from '@/types/models';
import { Sparkline } from './Sparkline';

const dateLabel = (ms: number) => new Date(ms).toLocaleDateString();

export function MetricCard({ kind, points, onPress }: {
  kind: MeasurementKind; points: TrendPoint[]; onPress: () => void;
}) {
  const t = useTheme();
  const meta = MEAS_META[kind];
  const [w, setW] = useState(0);
  const latest = points.length ? points[points.length - 1] : null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={latest ? `${meta.label}, view history` : `${meta.label}, add measurement`}
      style={(s) => [
        { width: '47.8%', flexGrow: 1, backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, borderRadius: 20, padding: 15, minHeight: 96, cursor: 'pointer' },
        isHovered(s) && { borderColor: hexA(meta.color, 0.5), boxShadow: t.shadow },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <View style={{ width: 9, height: 9, borderRadius: 99, backgroundColor: meta.color }} />
        <Txt weight={600} size={11.5} color={t.dim} style={{ textTransform: 'uppercase' }}>{meta.short}</Txt>
      </View>
      {latest ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <Txt weight={800} size={24} tracking={-0.4}>{latest.value}</Txt>
            {meta.unit ? <Txt weight={600} size={13} color={t.dim} style={{ marginLeft: 3 }}>{meta.unit}</Txt> : null}
          </View>
          {points.length >= 2 ? (
            <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ marginTop: 8, height: 30 }}>
              <Sparkline points={points} color={meta.color} width={w} height={30} />
            </View>
          ) : null}
          <Txt weight={500} size={12} color={t.faint} style={{ marginTop: 4 }}>{dateLabel(latest.t)}</Txt>
        </>
      ) : (
        <Txt weight={600} size={13.5} color={meta.color} style={{ marginTop: 4 }}>+ Tap to add</Txt>
      )}
    </Pressable>
  );
}
```

- [ ] **Step 2: Verify types pass**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/measurements/MetricCard.tsx
git commit -m "feat(growth): add MetricCard with latest value + sparkline"
```

---

### Task 5: Per-metric detail screen + route registration

**Files:**
- Create: `src/app/metric/[kind].tsx`
- Modify: `src/app/_layout.tsx` (register the route in the root `Stack`)

**Interfaces:**
- Consumes: `seriesFor`, `yTicksFor`, `changeSince` (Task 1); `TrendChart` time mode (Task 2); `MEAS_KINDS`, `MEAS_META`; store actions `openMeasurement`, `openEditMeasurement`, `openSwitcher`.
- Produces: route `/metric/[kind]`, reached via `router.push({ pathname: '/metric/[kind]', params: { kind } })`.

- [ ] **Step 1: Register the route**

In `src/app/_layout.tsx`, add the screen inside the `<Stack>` (after the `settings` screen, around line 89):

```tsx
      <Stack.Screen name="settings" />
      <Stack.Screen name="metric/[kind]" />
```

- [ ] **Step 2: Write the detail screen**

Create `src/app/metric/[kind].tsx`:

```tsx
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { isHovered } from '@/components/hover';
import { IconButton } from '@/components/IconButton';
import { Txt } from '@/components/Txt';
import { changeSince, seriesFor, yTicksFor } from '@/features/measurements/growthChart';
import { TrendChart } from '@/features/insights/TrendChart';
import { hexA } from '@/lib/color';
import { MEAS_KINDS, MEAS_META } from '@/lib/measurements';
import { DesktopPage } from '@/shell/DesktopPage';
import { useDesktopShell } from '@/shell/useDesktopShell';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';
import type { MeasurementKind } from '@/types/models';

const shortDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const rowDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const GOOD = '#3E9E6E';

export default function MetricDetailRoute() {
  const { kind } = useLocalSearchParams<{ kind: string }>();
  if (!MEAS_KINDS.includes(kind as MeasurementKind)) return <Redirect href="/growth" />;
  return <MetricDetail kind={kind as MeasurementKind} />;
}

function MetricDetail({ kind }: { kind: MeasurementKind }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const desktop = useDesktopShell();
  const [width, setWidth] = useState(0);
  const measurements = useAppStore((s) => s.measurements);
  const child = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId));
  const openSwitcher = useAppStore((s) => s.openSwitcher);
  const openMeasurement = useAppStore((s) => s.openMeasurement);
  const openEditMeasurement = useAppStore((s) => s.openEditMeasurement);

  const meta = MEAS_META[kind];
  const points = seriesFor(measurements, kind);
  const latest = points.length ? points[points.length - 1] : null;
  const change = changeSince(points);
  const { ticks, fmtY } = yTicksFor(points);
  const history = measurements.filter((x) => x.kind === kind).sort((a, b) => b.date - a.date);

  const body = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: change ? 4 : 16 }}>
        {latest ? (
          <>
            <Txt weight={800} size={34} tracking={-0.6}>{latest.value}</Txt>
            {meta.unit ? <Txt weight={600} size={16} color={t.dim}>{meta.unit}</Txt> : null}
          </>
        ) : (
          <Txt weight={700} size={20} color={t.dim}>No data yet</Txt>
        )}
      </View>
      {change ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 16 }}>
          <View style={{ backgroundColor: change.delta >= 0 ? hexA(GOOD, 0.14) : t.chip, borderRadius: 9, paddingHorizontal: 8, paddingVertical: 2 }}>
            <Txt weight={700} size={12} color={change.delta >= 0 ? GOOD : t.faint}>
              {change.delta >= 0 ? '+' : ''}{Math.round(change.delta * 100) / 100}{meta.unit ? ` ${meta.unit}` : ''}
            </Txt>
          </View>
          <Txt weight={500} size={12.5} color={t.faint}>since {shortDate(change.sinceT)}</Txt>
        </View>
      ) : null}

      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, borderRadius: 20, padding: 16, marginBottom: 22 }}>
        {points.length >= 2 ? (
          <TrendChart
            points={points}
            band={null}
            color={meta.color}
            yTicks={ticks}
            fmtY={fmtY}
            width={width - 32}
            xMode="time"
            xStartLabel={shortDate(points[0].t)}
            xEndLabel={shortDate(points[points.length - 1].t)}
          />
        ) : (
          <Txt weight={500} size={13.5} color={t.faint} style={{ paddingVertical: 20, textAlign: 'center' }}>
            {points.length === 1 ? 'Add another measurement to see a trend.' : 'No measurements yet.'}
          </Txt>
        )}
      </View>

      <Txt weight={700} size={12.5} color={t.faint} tracking={0.8} style={{ marginHorizontal: 4, marginBottom: 9, textTransform: 'uppercase' }}>
        History
      </Txt>
      {history.length === 0 ? (
        <Txt weight={500} size={14} color={t.dim} style={{ marginHorizontal: 4, marginBottom: 20 }}>Nothing logged yet.</Txt>
      ) : (
        <View style={{ gap: 8, marginBottom: 20 }}>
          {history.map((mm) => (
            <Pressable
              key={mm.id}
              onPress={() => openEditMeasurement(mm.id)}
              accessibilityRole="button"
              style={(s) => [
                { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14, backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, borderRadius: 18, cursor: 'pointer' },
                isHovered(s) && { borderColor: hexA(meta.color, 0.5) },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Txt weight={700} size={15.5} tracking={-0.2}>{mm.value}{meta.unit ? ` ${meta.unit}` : ''}</Txt>
                {mm.notes ? <Txt weight={500} size={13} color={t.dim} style={{ marginTop: 1 }}>{mm.notes}</Txt> : null}
              </View>
              <Txt weight={600} size={13} color={t.faint} style={{ fontVariant: ['tabular-nums'] }}>{rowDate(mm.date)}</Txt>
            </Pressable>
          ))}
        </View>
      )}

      <Pressable
        onPress={() => openMeasurement(kind)}
        accessibilityRole="button"
        style={(s) => [
          { height: 56, borderRadius: 18, backgroundColor: meta.color, alignItems: 'center', justifyContent: 'center', boxShadow: `0px 8px 22px ${hexA(meta.color, 0.35)}`, cursor: 'pointer' },
          isHovered(s) && { boxShadow: `0px 8px 22px ${hexA(meta.color, 0.5)}` },
        ]}
      >
        <Txt unselectable weight={800} size={16.5} color={t.onActivity}>+ Add {meta.short.toLowerCase()}</Txt>
      </Pressable>
    </>
  );

  if (desktop) {
    return (
      <DesktopPage maxWidth={640}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <IconButton name="chevron-left" color={t.text} onPress={() => router.back()} accessibilityLabel="Back" />
          <Txt weight={800} size={24} tracking={-0.5}>{meta.label}</Txt>
        </View>
        {body}
      </DesktopPage>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: insets.bottom + 24 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4, marginBottom: 14 }}>
        <IconButton name="chevron-left" color={t.text} onPress={() => router.back()} accessibilityLabel="Back" />
        <Txt weight={800} size={27} tracking={-0.6} style={{ flex: 1 }}>{meta.label}</Txt>
        <Pressable
          onPress={openSwitcher}
          accessibilityRole="button"
          accessibilityLabel={child ? `${child.first}, switch child` : 'Switch child'}
          style={(s) => [{ cursor: 'pointer' }, isHovered(s) && { opacity: 0.85 }]}
        >
          <Avatar child={child} size={38} radius={12} fontSize={16} />
        </Pressable>
      </View>
      {body}
    </ScrollView>
  );
}
```

- [ ] **Step 3: Verify types + route**

Run: `npx tsc --noEmit`
Expected: no errors. If typed-routes flags `href="/growth"` or the `pathname`, regenerate types with `npx expo customize tsconfig.json` is NOT needed — instead run `npx expo start` once to regenerate `.expo/types`, or confirm the tab route path. `/growth` is the correct typed href for `(tabs)/growth.tsx` (groups are stripped from URLs).

Run: `npm run lint`
Expected: no errors (no unused imports).

- [ ] **Step 4: Commit**

```bash
git add src/app/metric/[kind].tsx src/app/_layout.tsx
git commit -m "feat(growth): add per-metric detail screen with curve + history"
```

---

### Task 6: Wire the overview to cards + detail, remove the mixed list

**Files:**
- Modify: `src/app/(tabs)/growth.tsx`

**Interfaces:**
- Consumes: `MetricCard` (Task 4), `seriesFor` (Task 1), the `/metric/[kind]` route (Task 5), `openMeasurement`.

- [ ] **Step 1: Replace the growth tab body**

Rewrite `src/app/(tabs)/growth.tsx` so the card grid uses `MetricCard` (tap routes to detail when the metric has data, else opens the add sheet) and the mixed "Recent" list is removed:

```tsx
import { router } from 'expo-router';
import { ScrollView, View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { isHovered } from '@/components/hover';
import { Txt } from '@/components/Txt';
import { MetricCard } from '@/features/measurements/MetricCard';
import { seriesFor } from '@/features/measurements/growthChart';
import { MEAS_KINDS } from '@/lib/measurements';
import { DesktopPage } from '@/shell/DesktopPage';
import { useDesktopShell } from '@/shell/useDesktopShell';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

export default function Growth() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const desktop = useDesktopShell();
  const measurements = useAppStore((s) => s.measurements);
  const child = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId));
  const openSwitcher = useAppStore((s) => s.openSwitcher);
  const openMeasurement = useAppStore((s) => s.openMeasurement);

  const body = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 11 }}>
      {MEAS_KINDS.map((kind) => {
        const points = seriesFor(measurements, kind);
        return (
          <MetricCard
            key={kind}
            kind={kind}
            points={points}
            onPress={() =>
              points.length
                ? router.push({ pathname: '/metric/[kind]', params: { kind } })
                : openMeasurement(kind)
            }
          />
        );
      })}
    </View>
  );

  if (desktop) return <DesktopPage maxWidth={640}>{body}</DesktopPage>;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: 24 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2, paddingTop: 4, paddingBottom: 16 }}>
        <Txt weight={800} size={27} tracking={-0.6}>
          Growth
        </Txt>
        <Pressable
          onPress={openSwitcher}
          accessibilityRole="button"
          accessibilityLabel={child ? `${child.first}, switch child` : 'Switch child'}
          style={(s) => [{ cursor: 'pointer' }, isHovered(s) && { opacity: 0.85 }]}
        >
          <Avatar child={child} size={38} radius={12} fontSize={16} />
        </Pressable>
      </View>
      {body}
    </ScrollView>
  );
}
```

- [ ] **Step 2: Verify types + lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors, no unused imports (the old `Icon`, `hexA`, `MEAS_META`, `openEditMeasurement` usages are gone).

- [ ] **Step 3: Commit**

```bash
git add "src/app/(tabs)/growth.tsx"
git commit -m "feat(growth): overview cards route to per-metric detail; drop mixed list"
```

---

### Task 7: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Full test + type + lint sweep**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all green.

- [ ] **Step 2: Drive the app (web is quickest)**

Run: `npm run web`, then with demo/seed data:
- Growth tab shows four cards; cards with 2+ measurements show a sparkline.
- Tap a card with data -> pushes the detail screen: big value, change pill "since <date>", time-proportional curve, History (newest first), Add button.
- Tap a card with no data -> opens the add sheet directly (no navigation).
- In detail: tap a history row -> edit sheet opens; edit/delete round-trips and the curve + history update.
- Tap Add in detail -> add sheet; saving appends a point and the curve updates.
- Back button returns to Growth.
- Insights tab trend charts look identical to before (regression check on the `TrendChart` change).

- [ ] **Step 3: Desktop check**

Resize the browser wide (desktop shell). The detail screen renders inside the sidebar shell via `DesktopPage`, with a back chevron + metric title; back returns to Growth.

- [ ] **Step 4: Final confirmation**

No commit needed unless verification surfaced fixes. If fixes were made, commit them with a `fix(growth): ...` message.

---

## Self-review notes

- **Spec coverage:** sparklines on cards (Task 4/6), per-metric detail curve (Task 5 via Task 2), per-metric history (Task 5), remove mixed list (Task 6), tap-with-data vs tap-empty behavior (Task 6), dynamic ticks/delta (Task 1), desktop parity (Task 5), reuse `MeasurementSheet`/store (Tasks 5/6). Out-of-scope items (percentile bands, range toggles, age x-axis) intentionally absent.
- **No placeholders:** every code step has complete source.
- **Type consistency:** `seriesFor`/`yTicksFor`/`changeSince` signatures are identical across Tasks 1, 4, 5, 6; `TrendChart`'s new props (`xMode`, `xStartLabel`, `xEndLabel`) are defined in Task 2 and consumed in Task 5; `MetricCard({ kind, points, onPress })` defined in Task 4, consumed in Task 6.
