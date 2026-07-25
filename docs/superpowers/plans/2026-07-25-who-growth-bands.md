# WHO growth-standard percentile curves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overlay WHO growth-standard percentile curves (3/15/50/85/97) on each growth metric's detail chart when the child's gender is girl or boy, on by default with a toggle to hide.

**Architecture:** A static WHO LMS table (`whoLms.ts`) feeds a pure `referenceCurves()` sampler (`whoReference.ts`) that produces five labelled polylines across the chart's visible age range, in display units. `TrendChart` gains an additive `curves` prop to draw them behind the child's line; the metric detail screen wires it up with a persisted toggle and a source/disclaimer info modal.

**Tech Stack:** Expo SDK 56 (React Native), TypeScript, `react-native-svg`, zustand store, AsyncStorage prefs, vitest.

## Global Constraints

- Read exact Expo v56 docs before writing code: https://docs.expo.dev/versions/v56.0.0/
- No em-dashes in any prose, comment, or UI copy (use commas/colons/parentheses).
- Measurement values are stored canonical metric (kg/cm); imperial is a display lens applied via `toDisplay(kind, value, system)` from `@/lib/units`.
- WHO Child Growth Standards cover ages 0 to 60 months only; draw nothing past 60 months.
- Percentiles shown: 3rd, 15th, 50th, 85th, 97th. The 50th is emphasised.
- Reference lines use theme neutrals (`t.dim` for the 50th, `t.faint` for the rest), never the metric colour.
- Reference applies only to gender `girl` or `boy`. `other` shows a caption; unrecorded shows nothing.
- `TrendChart` changes must be additive and non-breaking (Insights callers pass no `curves`).
- WHO source URL: `https://www.who.int/tools/child-growth-standards/standards`

---

### Task 1: Persisted "show WHO reference" toggle

**Files:**
- Modify: `.gitignore` (add `.superpowers/`)
- Modify: `src/data/prefs.ts` (add field to `Prefs`)
- Test: `src/data/prefs.test.ts`
- Modify: `src/store/useAppStore.ts` (state + action + hydrate)
- Test: `src/store/useAppStore.test.ts`

**Interfaces:**
- Produces: store state `showGrowthReference: boolean` (default `true`); action `setGrowthReference(on: boolean): void`; `Prefs.showGrowthReference?: boolean`.

- [ ] **Step 1: Ignore the brainstorm scratch dir**

Append to `.gitignore`:

```
.superpowers/
```

- [ ] **Step 2: Write the failing prefs test**

Add to `src/data/prefs.test.ts`:

```ts
it('round-trips showGrowthReference', async () => {
  await savePrefs({ showGrowthReference: false });
  expect(await loadPrefs()).toEqual({ showGrowthReference: false });
});
```

- [ ] **Step 3: Run it, expect fail**

Run: `npx vitest run src/data/prefs.test.ts`
Expected: FAIL (type error on `showGrowthReference`, or the field is dropped).

- [ ] **Step 4: Add the field to `Prefs`**

In `src/data/prefs.ts`, inside `interface Prefs`, after the rhythm layer booleans:

```ts
  /**
   * Growth charts: whether the WHO growth-standard percentile curves are drawn
   * behind a metric's own line. Global (like every other pref), default on.
   */
  showGrowthReference: boolean;
```

- [ ] **Step 5: Run prefs test, expect pass**

Run: `npx vitest run src/data/prefs.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing store test**

Add to `src/store/useAppStore.test.ts` (match the file's existing setup for building a store):

```ts
it('defaults showGrowthReference on and toggles + persists it', async () => {
  const s = useAppStore.getState();
  expect(s.showGrowthReference).toBe(true);
  s.setGrowthReference(false);
  expect(useAppStore.getState().showGrowthReference).toBe(false);
  expect(await loadPrefs()).toMatchObject({ showGrowthReference: false });
});
```

Ensure `loadPrefs` is imported in the test (mirror how existing persistence tests import it).

- [ ] **Step 7: Run it, expect fail**

Run: `npx vitest run src/store/useAppStore.test.ts -t showGrowthReference`
Expected: FAIL (`setGrowthReference is not a function`).

- [ ] **Step 8: Add state, action, and hydrate load**

In `src/store/useAppStore.ts`:

Add to the `AppActions` interface (near `setRhythmLayer`):

```ts
  /** Toggle the WHO growth-reference overlay on the metric charts, and persist it. */
  setGrowthReference: (on: boolean) => void;
```

Add to the initial state object (near `unitSystem: 'metric',`):

```ts
  showGrowthReference: true,
```

Add the action (near `setRhythmLayer`):

```ts
  setGrowthReference: (on) => {
    set({ showGrowthReference: on });
    void savePrefs({ showGrowthReference: on });
  },
```

Add to `hydrate`, alongside the other `prefs.*` reads (use `!= null`, not truthy, so a stored `false` is honoured):

```ts
    if (prefs.showGrowthReference != null) set({ showGrowthReference: prefs.showGrowthReference });
```

Also add `showGrowthReference: boolean;` to the store state interface (`AppState`/`AppStore`, wherever `unitSystem: UnitSystem;` is declared).

- [ ] **Step 9: Run store test, expect pass**

Run: `npx vitest run src/store/useAppStore.test.ts -t showGrowthReference`
Expected: PASS.

- [ ] **Step 10: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add .gitignore src/data/prefs.ts src/data/prefs.test.ts src/store/useAppStore.ts src/store/useAppStore.test.ts
git commit -m "feat(growth): persist a show-WHO-reference toggle pref"
```

---

### Task 2: WHO reference math primitives

**Files:**
- Create: `src/features/measurements/whoReference.ts`
- Test: `src/features/measurements/whoReference.test.ts`

**Interfaces:**
- Produces:
  - `interface Lms { L: number; M: number; S: number }`
  - `valueAtZ(lms: Lms, z: number): number`
  - `hasWhoAgeOverlap(birthMs: number, tMin: number, tMax: number): boolean`
  - `const MONTH_MS: number` (exported for tests)
  - `const PCTS: { p: number; z: number; emphasis: boolean }[]`

- [ ] **Step 1: Write the failing test**

Create `src/features/measurements/whoReference.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { valueAtZ, hasWhoAgeOverlap, MONTH_MS } from './whoReference';

describe('valueAtZ (WHO LMS formula)', () => {
  // WHO girls weight-for-age, month 0: L=0.3487, M=3.2322, S=0.14171.
  // Median (z=0) is exactly M; P3 (z=-1.88079) and P97 (z=+1.88079) match
  // WHO's published 3rd/97th centiles (~2.40 / ~4.23 kg).
  const lms = { L: 0.3487, M: 3.2322, S: 0.14171 };
  it('returns M at z=0', () => {
    expect(valueAtZ(lms, 0)).toBeCloseTo(3.2322, 3);
  });
  it('matches WHO 3rd and 97th centiles', () => {
    expect(valueAtZ(lms, -1.88079)).toBeCloseTo(2.4, 1);
    expect(valueAtZ(lms, 1.88079)).toBeCloseTo(4.23, 1);
  });
  it('uses the exp branch when L is ~0', () => {
    // L=0 => X = M*exp(S*z)
    expect(valueAtZ({ L: 0, M: 16, S: 0.1 }, 1)).toBeCloseTo(16 * Math.exp(0.1), 5);
  });
});

describe('hasWhoAgeOverlap', () => {
  const birth = 1_000_000_000_000;
  it('true when the range sits inside 0..60 months', () => {
    expect(hasWhoAgeOverlap(birth, birth + 2 * MONTH_MS, birth + 10 * MONTH_MS)).toBe(true);
  });
  it('false when the whole range is past 60 months', () => {
    expect(hasWhoAgeOverlap(birth, birth + 61 * MONTH_MS, birth + 70 * MONTH_MS)).toBe(false);
  });
  it('true when the range straddles birth (age 0)', () => {
    expect(hasWhoAgeOverlap(birth, birth - 5 * MONTH_MS, birth + 3 * MONTH_MS)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, expect fail**

Run: `npx vitest run src/features/measurements/whoReference.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the primitives**

Create `src/features/measurements/whoReference.ts`:

```ts
/**
 * WHO Child Growth Standards, applied to a child's growth chart. The reference
 * is drawn only for a recorded girl/boy gender and only for ages 0 to 60
 * months (WHO's range). Curves are computed from the LMS parameters in
 * `whoLms.ts` via the standard WHO formula.
 */

/** LMS parameters for one age: Box-Cox power (L), median (M), coeff. of var (S). */
export interface Lms {
  L: number;
  M: number;
  S: number;
}

/** Average month length; WHO ages are in completed months. 365.25/12 days. */
export const MONTH_MS = 30.4375 * 86_400_000;

/** The percentiles drawn, with their standard-normal z-scores. 50th emphasised. */
export const PCTS: { p: number; z: number; emphasis: boolean }[] = [
  { p: 3, z: -1.88079, emphasis: false },
  { p: 15, z: -1.03643, emphasis: false },
  { p: 50, z: 0, emphasis: true },
  { p: 85, z: 1.03643, emphasis: false },
  { p: 97, z: 1.88079, emphasis: false },
];

/** WHO LMS -> the measurement value at z standard deviations from the median. */
export function valueAtZ({ L, M, S }: Lms, z: number): number {
  // L can be exactly 0 (e.g. some BMI rows); the power form is undefined there.
  return Math.abs(L) < 1e-7 ? M * Math.exp(S * z) : M * Math.pow(1 + L * S * z, 1 / L);
}

/** Does the visible time range cover any age in WHO's 0..60 month window? */
export function hasWhoAgeOverlap(birthMs: number, tMin: number, tMax: number): boolean {
  const ageMinMonths = (tMin - birthMs) / MONTH_MS;
  const ageMaxMonths = (tMax - birthMs) / MONTH_MS;
  return ageMaxMonths >= 0 && ageMinMonths <= 60;
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/features/measurements/whoReference.test.ts`
Expected: PASS (all 6).

- [ ] **Step 5: Commit**

```bash
git add src/features/measurements/whoReference.ts src/features/measurements/whoReference.test.ts
git commit -m "feat(growth): WHO LMS formula + age-overlap helper"
```

---

### Task 3: Embed and verify the WHO LMS tables

**Files:**
- Create: `src/features/measurements/whoLms.ts`
- Test: `src/features/measurements/whoLms.test.ts`

**Interfaces:**
- Consumes: `Lms` from `./whoReference`.
- Produces: `type Sex = 'girl' | 'boy'`; `type LmsTable = Lms[]` (length 61, index = month 0..60); `const WHO_LMS: Record<MeasurementKind, Record<Sex, LmsTable>>`.

**Data source:** Transcribe from WHO's official expanded tables for each indicator and sex (weight-for-age, length/height-for-age, head-circumference-for-age, BMI-for-age), 0 to 60 months. Each WHO expanded percentile file carries the `L`, `M`, `S` columns plus the published percentile columns; take L/M/S per month and keep the percentile columns to build the oracle in the test. Obtain the files during execution (WHO CDN download page linked above); do not invent numbers.

- [ ] **Step 1: Write the accuracy test (the gate)**

Create `src/features/measurements/whoLms.test.ts`. Assert that percentiles recomputed from the embedded LMS match WHO's own published percentile values within tolerance. Seed with these known WHO medians (P50 == M) and 3rd/97th centiles, and expand from the fetched percentile files during Step 3:

```ts
import { describe, it, expect } from 'vitest';
import { WHO_LMS } from './whoLms';
import { valueAtZ } from './whoReference';

const P3 = -1.88079, P50 = 0, P97 = 1.88079;

describe('WHO LMS tables reproduce published centiles', () => {
  // [kind, sex, month, p3, p50, p97] from WHO published tables.
  const CASES: [keyof typeof WHO_LMS, 'girl' | 'boy', number, number, number, number][] = [
    ['weight', 'girl', 0, 2.4, 3.2, 4.2],
    ['weight', 'girl', 12, 7.0, 8.9, 11.5],
    ['weight', 'girl', 60, 12.1, 18.2, 26.2],
    ['weight', 'boy', 0, 2.5, 3.3, 4.4],
    ['weight', 'boy', 12, 7.7, 9.6, 12.0],
    ['height', 'girl', 0, 45.6, 49.1, 52.7],
    ['height', 'boy', 24, 81.7, 87.8, 93.9],
    ['head', 'girl', 0, 31.5, 33.9, 36.2],
    ['head', 'boy', 0, 32.1, 34.5, 36.9],
  ];
  it.each(CASES)('%s %s @ %d mo', (kind, sex, month, p3, p50, p97) => {
    const lms = WHO_LMS[kind][sex][month];
    expect(valueAtZ(lms, P50)).toBeCloseTo(p50, 1);
    expect(valueAtZ(lms, P3)).toBeCloseTo(p3, 1);
    expect(valueAtZ(lms, P97)).toBeCloseTo(p97, 1);
  });

  it('every table has 61 monthly rows', () => {
    for (const kind of ['weight', 'height', 'head', 'bmi'] as const)
      for (const sex of ['girl', 'boy'] as const)
        expect(WHO_LMS[kind][sex]).toHaveLength(61);
  });
});
```

- [ ] **Step 2: Run it, expect fail**

Run: `npx vitest run src/features/measurements/whoLms.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `whoLms.ts` with the transcribed tables**

Fetch the WHO expanded tables, transcribe L/M/S per month, and fill the oracle in Step 1 from the same files' percentile columns. Shape:

```ts
import type { MeasurementKind } from '@/types/models';
import type { Lms } from './whoReference';

export type Sex = 'girl' | 'boy';
/** One row per completed month, index 0..60. */
export type LmsTable = Lms[];

// Values transcribed from the WHO Child Growth Standards expanded tables
// (0 to 60 months). M is metric: kg (weight), cm (height/head), kg/m^2 (BMI).
export const WHO_LMS: Record<MeasurementKind, Record<Sex, LmsTable>> = {
  weight: { girl: [ /* {L,M,S} x61 */ ], boy: [ /* ... */ ] },
  height: { girl: [ /* ... */ ], boy: [ /* ... */ ] },
  head:   { girl: [ /* ... */ ], boy: [ /* ... */ ] },
  bmi:    { girl: [ /* ... */ ], boy: [ /* ... */ ] },
};
```

- [ ] **Step 4: Run the accuracy test, expect pass**

Run: `npx vitest run src/features/measurements/whoLms.test.ts`
Expected: PASS. If any case is off by more than the tolerance, the LMS row was mis-transcribed; fix the number, do not loosen the tolerance.

- [ ] **Step 5: Commit**

```bash
git add src/features/measurements/whoLms.ts src/features/measurements/whoLms.test.ts
git commit -m "feat(growth): embed WHO LMS growth-standard tables, verified against published centiles"
```

---

### Task 4: `referenceCurves` sampler

**Files:**
- Modify: `src/features/measurements/whoReference.ts`
- Test: `src/features/measurements/whoReference.test.ts`

**Interfaces:**
- Consumes: `WHO_LMS`, `Sex` from `./whoLms`; `valueAtZ`, `PCTS`, `MONTH_MS`, `hasWhoAgeOverlap`; `toDisplay` from `@/lib/units`; `MeasurementKind`, `ChildGender` from `@/types/models`.
- Produces:
  - `interface GrowthCurve { p: number; label: string; emphasis: boolean; points: { t: number; value: number }[] }`
  - `referenceCurves(kind, gender, birthMs, tMin, tMax, unitSystem): GrowthCurve[] | null`

- [ ] **Step 1: Write the failing tests**

Add to `src/features/measurements/whoReference.test.ts`:

```ts
import { referenceCurves } from './whoReference';

describe('referenceCurves', () => {
  const birth = 1_700_000_000_000;
  const tMin = birth + 1 * MONTH_MS;
  const tMax = birth + 6 * MONTH_MS;

  it('returns null for non-girl/boy genders', () => {
    expect(referenceCurves('weight', 'other', birth, tMin, tMax, 'metric')).toBeNull();
    expect(referenceCurves('weight', undefined, birth, tMin, tMax, 'metric')).toBeNull();
  });

  it('returns null when the whole range is past 60 months', () => {
    const late = birth + 61 * MONTH_MS;
    expect(referenceCurves('weight', 'girl', birth, late, late + MONTH_MS, 'metric')).toBeNull();
  });

  it('produces five curves with endpoints at tMin and tMax', () => {
    const curves = referenceCurves('weight', 'girl', birth, tMin, tMax, 'metric');
    expect(curves).not.toBeNull();
    expect(curves!.map((c) => c.p)).toEqual([3, 15, 50, 85, 97]);
    for (const c of curves!) {
      expect(c.points[0].t).toBe(tMin);
      expect(c.points[c.points.length - 1].t).toBe(tMax);
      expect(c.points.every((p, i, a) => i === 0 || p.t >= a[i - 1].t)).toBe(true);
    }
  });

  it('clamps the last sample to age 60 months when the range straddles it', () => {
    const t60 = birth + 60 * MONTH_MS;
    const curves = referenceCurves('weight', 'boy', birth, birth + 58 * MONTH_MS, birth + 64 * MONTH_MS, 'metric');
    expect(curves).not.toBeNull();
    for (const c of curves!) expect(c.points[c.points.length - 1].t).toBe(t60);
  });

  it('converts to imperial (weight in lb > metric kg)', () => {
    const metric = referenceCurves('weight', 'girl', birth, tMin, tMax, 'metric')!;
    const imperial = referenceCurves('weight', 'girl', birth, tMin, tMax, 'imperial')!;
    const m50 = metric.find((c) => c.p === 50)!.points[0].value;
    const i50 = imperial.find((c) => c.p === 50)!.points[0].value;
    expect(i50).toBeGreaterThan(m50 * 2); // ~2.2 lb per kg
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npx vitest run src/features/measurements/whoReference.test.ts -t referenceCurves`
Expected: FAIL (`referenceCurves` not exported).

- [ ] **Step 3: Implement `referenceCurves` + `lmsAtAge`**

Append to `src/features/measurements/whoReference.ts` (add imports at top):

```ts
import { toDisplay } from '@/lib/units';
import type { UnitSystem } from '@/lib/units';
import type { ChildGender, MeasurementKind } from '@/types/models';
import { WHO_LMS, type Sex } from './whoLms';
```

```ts
export interface GrowthCurve {
  p: number;
  label: string;
  emphasis: boolean;
  points: { t: number; value: number }[];
}

/** LMS at a fractional age (months), linearly interpolating between rows. */
function lmsAtAge(table: Lms[], ageMonths: number): Lms {
  const a = Math.max(0, Math.min(60, ageMonths));
  const lo = Math.floor(a);
  const hi = Math.min(60, lo + 1);
  const f = a - lo;
  const A = table[lo], B = table[hi];
  return { L: A.L + (B.L - A.L) * f, M: A.M + (B.M - A.M) * f, S: A.S + (B.S - A.S) * f };
}

/**
 * The five WHO percentile curves for `kind` and `gender`, sampled monthly
 * across the visible time range [tMin, tMax] and clamped to ages 0..60 months,
 * in the caller's display units. Returns null when no reference applies
 * (gender not girl/boy, or the range is entirely outside 0..60 months).
 */
export function referenceCurves(
  kind: MeasurementKind,
  gender: ChildGender | undefined,
  birthMs: number,
  tMin: number,
  tMax: number,
  unitSystem: UnitSystem,
): GrowthCurve[] | null {
  if (gender !== 'girl' && gender !== 'boy') return null;
  const table = WHO_LMS[kind]?.[gender as Sex];
  if (!table) return null;
  if (!hasWhoAgeOverlap(birthMs, tMin, tMax)) return null;

  const t0 = Math.max(tMin, birthMs); // clamp to age >= 0
  const t1 = Math.min(tMax, birthMs + 60 * MONTH_MS); // clamp to age <= 60
  if (t1 < t0) return null;

  // Sample at both endpoints plus every whole-month boundary strictly between.
  const ts: number[] = [t0];
  const first = Math.floor((t0 - birthMs) / MONTH_MS) + 1;
  const last = Math.ceil((t1 - birthMs) / MONTH_MS) - 1;
  for (let m = first; m <= last; m++) ts.push(birthMs + m * MONTH_MS);
  if (t1 > t0) ts.push(t1);

  return PCTS.map(({ p, z, emphasis }) => ({
    p,
    label: String(p),
    emphasis,
    points: ts.map((t) => ({
      t,
      value: toDisplay(kind, valueAtZ(lmsAtAge(table, (t - birthMs) / MONTH_MS), z), unitSystem),
    })),
  }));
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run src/features/measurements/whoReference.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/features/measurements/whoReference.ts src/features/measurements/whoReference.test.ts
git commit -m "feat(growth): sample WHO percentile curves across the visible age range"
```

---

### Task 5: Widen `yTicksFor` to include reference values

**Files:**
- Modify: `src/features/measurements/growthChart.ts`
- Test: `src/features/measurements/growthChart.test.ts`

**Interfaces:**
- Produces: `yTicksFor(points: TrendPoint[], extraValues?: number[]): { ticks: number[]; fmtY: (v: number) => string }` (second arg optional, default `[]`).

- [ ] **Step 1: Write the failing test**

Add to `src/features/measurements/growthChart.test.ts`:

```ts
it('yTicksFor widens the axis to include extra values', () => {
  const pts = [{ t: 1, value: 5 }, { t: 2, value: 6 }];
  const base = yTicksFor(pts);
  const wide = yTicksFor(pts, [0.5, 30]);
  expect(Math.max(...wide.ticks)).toBeGreaterThanOrEqual(30);
  expect(Math.min(...wide.ticks)).toBeLessThanOrEqual(0.5);
  // No extra values -> identical to the single-arg call.
  expect(yTicksFor(pts, []).ticks).toEqual(base.ticks);
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npx vitest run src/features/measurements/growthChart.test.ts -t "widens the axis"`
Expected: FAIL (extra values ignored; max tick < 30).

- [ ] **Step 3: Implement**

In `src/features/measurements/growthChart.ts`, change the `yTicksFor` signature and its first lines:

```ts
export function yTicksFor(points: TrendPoint[], extraValues: number[] = []): { ticks: number[]; fmtY: (v: number) => string } {
  const vals = points.map((p) => p.value).concat(extraValues);
```

(The rest of the function is unchanged; it already derives `lo`/`hi` from `vals`.)

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run src/features/measurements/growthChart.test.ts`
Expected: PASS (all, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/features/measurements/growthChart.ts src/features/measurements/growthChart.test.ts
git commit -m "feat(growth): let yTicksFor span extra reference values"
```

---

### Task 6: Draw reference curves in `TrendChart`

**Files:**
- Modify: `src/features/insights/TrendChart.tsx`

**Interfaces:**
- Consumes: a structurally-compatible curve shape (no import from measurements needed).
- Produces: additive prop `curves?: { points: { t: number; value: number }[]; emphasis?: boolean; label?: string }[]`.

- [ ] **Step 1: Add the prop to the signature and type**

In `src/features/insights/TrendChart.tsx`, add `curves` to the destructured props and the prop type block:

```tsx
export function TrendChart({ points, band, color, ruleOfThumb, yTicks, fmtY, width, xMode = 'index', xStartLabel = 'Start', xEndLabel = 'Today', xTicks, fmtX, dots = 'last', hover = false, unit, fmtValue, fmtHoverDate, calendarBands = false, dashGaps = false, curves }: {
  // ...existing prop types...
  /** Time mode only: WHO-style reference percentile lines drawn behind the data. */
  curves?: { points: { t: number; value: number }[]; emphasis?: boolean; label?: string }[];
}) {
```

- [ ] **Step 2: Reserve right-edge room for percentile labels**

Change the `right` constant so labelled curves have room (still 6 when absent, so nothing else shifts):

```tsx
  const right = curves && curves.length ? 22 : 6;
```

(Delete `right` from the existing `const gutter = 30, right = 6, top = 8, ...` line and declare it separately as above; keep `gutter`, `top`, `plotH`, `axisH` as they are.)

- [ ] **Step 3: Draw the curves behind the data line**

Immediately after the `band` `<Path>` block (before the `yTicks` gridlines, so curves sit behind gridlines and the data line), add:

```tsx
      {xMode === 'time' && curves?.map((c, ci) => (
        <Path
          key={`rc${ci}`}
          d={c.points.map((p, i) => `${i ? 'L' : 'M'} ${xAtT(p.t).toFixed(1)} ${yv(p.value).toFixed(1)}`).join(' ')}
          fill="none"
          stroke={c.emphasis ? t.dim : t.faint}
          strokeWidth={c.emphasis ? 1.6 : 1.1}
          opacity={c.emphasis ? 0.9 : 0.7}
        />
      ))}
```

- [ ] **Step 4: Label each curve at the right edge**

After the existing `xTicks`/axis-label block (labels paint last), add:

```tsx
      {xMode === 'time' && curves?.map((c, ci) => {
        const last = c.points[c.points.length - 1];
        if (!last) return null;
        return (
          <SvgText key={`rl${ci}`} x={gx + gw + 3} y={yv(last.value) + 3} fontSize={8} fontWeight="700" fontFamily={fontFamily(700)} fill={t.faint} textAnchor="start">{c.label}</SvgText>
        );
      })}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (No unit test: this is SVG rendering, verified manually in Task 7.)

- [ ] **Step 6: Commit**

```bash
git add src/features/insights/TrendChart.tsx
git commit -m "feat(growth): draw labelled reference percentile curves in TrendChart"
```

---

### Task 7: Wire the reference into the metric detail screen

**Files:**
- Modify: `src/features/insights/norms.ts` (export `DISCLAIMER`)
- Modify: `src/app/metric/[kind].tsx`

**Interfaces:**
- Consumes: `referenceCurves`, `hasWhoAgeOverlap` from `@/features/measurements/whoReference`; `yTicksFor(points, extra)`; store `showGrowthReference`, `setGrowthReference`; `DISCLAIMER` from `@/features/insights/norms`; `openBrowserAsync` from `expo-web-browser`.

- [ ] **Step 1: Export the shared disclaimer**

In `src/features/insights/norms.ts`, change:

```ts
const DISCLAIMER = 'General guidance, ...';
```
to:
```ts
export const DISCLAIMER = 'General guidance, not medical advice. Every baby is different, so speak to your doctor or paediatrician.';
```

- [ ] **Step 2: Compute the reference in the screen**

In `src/app/metric/[kind].tsx`, add imports:

```tsx
import { useState } from 'react'; // (already imported; keep as-is)
import { Modal } from 'react-native'; // add Modal to the existing 'react-native' import
import { openBrowserAsync } from 'expo-web-browser';
import { referenceCurves, hasWhoAgeOverlap } from '@/features/measurements/whoReference';
import { DISCLAIMER } from '@/features/insights/norms';
```

Add a constant near the top of the file:

```tsx
const WHO_URL = 'https://www.who.int/tools/child-growth-standards/standards';
```

Inside `MetricDetail`, after `const { ticks, fmtY } = yTicksFor(points);` is computed, replace that line and add the reference block:

```tsx
  const showRef = useAppStore((s) => s.showGrowthReference);
  const setRef = useAppStore((s) => s.setGrowthReference);
  const [refInfo, setRefInfo] = useState(false);
  const tMin = points.length ? points[0].t : 0;
  const tMax = points.length ? points[points.length - 1].t : 0;
  const overlap = !!child && points.length >= 2 && hasWhoAgeOverlap(child.birth, tMin, tMax);
  const isSexed = child?.gender === 'girl' || child?.gender === 'boy';
  const refAll = overlap && isSexed && child
    ? referenceCurves(kind, child.gender, child.birth, tMin, tMax, unitSystem)
    : null;
  const curves = showRef ? refAll : null;
  const refValues = curves?.flatMap((c) => c.points.map((p) => p.value)) ?? [];
  const { ticks, fmtY } = yTicksFor(points, refValues);
```

(Remove the original `const { ticks, fmtY } = yTicksFor(points);` line so it is declared once.)

- [ ] **Step 3: Render chip, curves, info modal, and caption**

Replace the chart card `<View onLayout ...>` block body. The chip + ⓘ sit above the chart; the caption sits below; `curves` is passed to `TrendChart`:

```tsx
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, borderRadius: 20, padding: 16, marginBottom: 22 }}>
        {refAll ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginBottom: 6 }}>
            <Pressable
              onPress={() => setRef(!showRef)}
              accessibilityRole="switch"
              accessibilityState={{ checked: showRef }}
              accessibilityLabel="WHO reference curves"
              style={(s) => [
                { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 10, borderRadius: 11, borderWidth: 1.5, borderColor: showRef ? hexA(t.dim, 0.5) : t.line, backgroundColor: showRef ? hexA(t.dim, 0.1) : t.chip, cursor: 'pointer' },
                isHovered(s) && { borderColor: t.dim },
              ]}
            >
              <View style={{ width: 16, height: 10, borderRadius: 5, backgroundColor: showRef ? t.dim : t.faint, justifyContent: 'center', paddingHorizontal: 1, alignItems: showRef ? 'flex-end' : 'flex-start' }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.surface }} />
              </View>
              <Txt unselectable weight={700} size={12} color={showRef ? t.text : t.dim}>WHO reference</Txt>
            </Pressable>
            <Pressable onPress={() => setRefInfo(true)} accessibilityRole="button" accessibilityLabel="About the WHO reference" style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 1.2, borderColor: t.faint, alignItems: 'center', justifyContent: 'center' }}>
              <Txt weight={700} size={12} color={t.faint}>i</Txt>
            </Pressable>
          </View>
        ) : null}
        {points.length >= 2 ? (
          <TrendChart
            points={points}
            band={null}
            curves={curves}
            color={meta.color}
            yTicks={ticks}
            fmtY={fmtY}
            width={width - 32}
            xMode="time"
            xStartLabel={shortDate(points[0].t)}
            xEndLabel={shortDate(points[points.length - 1].t)}
            xTicks={xTicks}
            fmtX={fmtX}
            dots="all"
            hover
            unit={unit}
            fmtHoverDate={tipDate}
          />
        ) : (
          <Txt weight={500} size={13.5} color={t.faint} style={{ paddingVertical: 20, textAlign: 'center' }}>
            {points.length === 1 ? 'Add another measurement to see a trend.' : 'No measurements yet.'}
          </Txt>
        )}
        {child?.gender === 'other' && overlap ? (
          <Txt weight={500} size={12} color={t.faint} style={{ marginTop: 10 }}>
            WHO growth curves compare girls and boys only.
          </Txt>
        ) : null}
      </View>

      <Modal visible={refInfo} transparent animationType="fade" onRequestClose={() => setRefInfo(false)}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
          <Pressable onPress={() => setRefInfo(false)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' }} />
          <View style={{ backgroundColor: t.surface, borderRadius: 18, padding: 20, gap: 8, width: '100%', maxWidth: 380 }}>
            <Txt weight={700} size={15}>WHO growth reference</Txt>
            <Txt weight={500} size={13} color={t.dim}>
              Source:{' '}
              <Txt weight={600} size={13} color={meta.color} style={{ textDecorationLine: 'underline' }} accessibilityRole="link" onPress={() => openBrowserAsync(WHO_URL)}>
                WHO Child Growth Standards
              </Txt>
            </Txt>
            <Txt weight={500} size={12.5} color={t.faint} style={{ lineHeight: 18 }}>{DISCLAIMER}</Txt>
          </View>
        </View>
      </Modal>
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Full test run**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 6: Manual verification (web)**

Follow the "Run/verify budkin on web" recipe. Confirm, on a child set to `girl` with 2+ weight logs:
- Five labelled percentile curves (3/15/50/85/97) render behind the gold line; 50th slightly bolder.
- The "WHO reference" chip toggles them off/on; with them off the y-axis relaxes and the source link/disclaimer are gone.
- The ⓘ opens the source + disclaimer modal; the WHO link opens.
- Switching the child to `boy` shifts the curves; to `other` shows the caption and no curves/chip; clearing gender shows neither.
- Light and dark both read well; desktop renders inside the shell.

- [ ] **Step 7: Commit**

```bash
git add src/features/insights/norms.ts "src/app/metric/[kind].tsx"
git commit -m "feat(growth): overlay WHO percentile curves on the metric chart with a toggle"
```

---

## Self-Review

**Spec coverage:**
- WHO standard, 4 metrics, girl/boy: Tasks 3, 4. ✓
- Option C five labelled lines, 50th emphasised, theme neutrals: Task 6. ✓
- Other-gender caption / unset shows nothing: Task 7 Step 3. ✓
- Toggle, on by default, persisted like unitSystem: Task 1. ✓
- Source + disclaimer (reuse pattern): Task 7 (ⓘ modal mirroring TrendCard). ✓
- Age clamp 0..60, no extrapolation: Task 4. ✓
- y-axis widened, no clipping: Task 5 + Task 7 Step 2. ✓
- Unit conversion: Task 4 test + impl. ✓
- Data accuracy gate: Task 3 Step 1/4. ✓
- Additive, non-breaking TrendChart: Task 6 (guarded by `xMode === 'time'` and optional prop). ✓

**Placeholder scan:** The only intentional blanks are the WHO LMS numeric rows in Task 3 Step 3, which are transcribed from the cited WHO source during execution and gated by the Step 1 accuracy test. No logic placeholders.

**Type consistency:** `Lms`, `GrowthCurve`, `referenceCurves`, `hasWhoAgeOverlap`, `WHO_LMS`, `Sex`, `setGrowthReference`, `showGrowthReference` are used with identical signatures across tasks. `TrendChart.curves` uses a structural subset of `GrowthCurve` (no import), which `GrowthCurve[]` satisfies.
