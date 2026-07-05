# Insights Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a purely-retrospective **Insights** tab: a sleep-rhythm heatmap plus six age-normed trend charts (sleep, feeding, diapers).

**Architecture:** New code lives under `src/features/insights/`, split into **pure computation** (`compute.ts`) and **cited reference data** (`norms.ts`) — both unit-tested — and presentational **`react-native-svg` chart components**. History deeper than the dashboard's 50-entry load is fetched **lazily on first tab open** (paginated, ~90 days) into a new store slice. The screen mirrors `growth.tsx`'s phone/desktop split.

**Tech Stack:** Expo Router (v56), React Native 0.85, `react-native-svg` (already a dependency), Zustand store, vitest.

## Global Constraints

- **Expo v56** — read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing Expo/RN API code (per `AGENTS.md`).
- **No new dependencies.** Charts use `react-native-svg`, already installed.
- **Charts import style:** `import Svg, { Rect, Path, Line, Circle, Text as SvgText } from 'react-native-svg'` (matches `src/components/Icon.tsx`).
- **Wet vs dirty are never summed.** A diaper that is both wet and dirty is `+1 wet` **and** `+1 dirty` in two independent series.
- **Heatmap axis is midnight-centred** (noon-to-noon window → x∈[0,1) where 0=noon, 0.5=midnight, 1=next noon).
- **Normative copy says "typical," never "should"**; every band exposes an ⓘ with `source` + the disclaimer *"General guidance, not medical advice. Ranges vary widely — ask your pediatrician."*
- **Demo mode must not hit the network** and must render a populated tab from local seed data.
- **Web/desktop parity:** the app runs on `react-native-web` with a desktop shell; the tab must appear in both the phone tab bar and the desktop sidebar.
- **Commits:** conventional-commit subjects (`feat(insights): …`), and every commit ends with the trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_012Q4ESUY8WaXdeU2Hcmud69
  ```
- Work happens on branch `feat/insights-tab` (already created).

---

## File Structure

**Create:**
- `src/features/insights/compute.ts` — pure aggregation (heatmap, trends, diapers)
- `src/features/insights/compute.test.ts`
- `src/features/insights/norms.ts` — cited age-bucketed reference ranges + banding
- `src/features/insights/norms.test.ts`
- `src/features/insights/SleepHeatmap.tsx` — the heatmap grid
- `src/features/insights/TrendChart.tsx` — reusable banded line chart
- `src/features/insights/TrendCard.tsx` — card chrome around a TrendChart
- `src/features/insights/DiaperBars.tsx` — grouped wet/dirty bars
- `src/app/(tabs)/insights.tsx` — the screen

**Modify:**
- `src/api/client.ts` — add `offset` param to `listSleep`/`listFeedings`/`listChanges`
- `src/data/repository.ts` — add `loadInsightsHistory`
- `src/store/useAppStore.ts` — insights slice + `loadInsights` action + child-switch reset
- `src/components/Icon.tsx` — add `insights` glyph
- `src/app/(tabs)/_layout.tsx` — register the screen
- `src/components/TabBar.tsx` — add the tab
- `src/shell/Sidebar.tsx` — add the sidebar item
- `src/shell/labels.ts` + `src/shell/labels.test.ts` — `/insights` title
- `src/theme/tokens.ts` — `insightWet` / `insightDirty` colors (both themes)

---

## Task 1: Pure sleep-heatmap computation

**Files:**
- Create: `src/features/insights/compute.ts`
- Test: `src/features/insights/compute.test.ts`

**Interfaces:**
- Consumes: `Entry` from `@/types/models`.
- Produces: `dayStart(ms)`, `noonWindowStart(ms)`, `HeatSegment`, `HeatRow`, `buildSleepHeatmap(entries, now, days=28): HeatRow[]` (rows ordered oldest→today, today last; `offsetFromToday` 0 = the **current, still-filling** noon-window — after today's noon that's a fresh row and last night sits at offset 1. Rows span the oldest in-range data window through offset 0 inclusive; interior gap days render as empty rows; no rows older than the data; `[]` when nothing is in range).

- [ ] **Step 1: Write the failing test**

```ts
// src/features/insights/compute.test.ts
import { describe, expect, it } from 'vitest';
import { buildSleepHeatmap, noonWindowStart } from './compute';
import type { Entry } from '@/types/models';

const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo, d, h, mi).getTime();
const sleep = (start: number, end: number, nap: boolean): Entry => ({
  id: `s-${start}`, childId: 'c1', type: 'sleep', start, end, nap, tags: [],
});

describe('buildSleepHeatmap', () => {
  const now = at(2026, 6, 5, 15); // 5 Jul 2026, 3pm

  it('places last night’s sleep in the current window when checked in the morning', () => {
    const morning = at(2026, 6, 5, 10); // before noon → the night’s window is still the current one
    const rows = buildSleepHeatmap([sleep(at(2026, 6, 4, 20), at(2026, 6, 5, 6), false)], morning);
    const today = rows[rows.length - 1];
    expect(today.offsetFromToday).toBe(0);
    expect(today.segments).toHaveLength(1);
    // 8pm = 8h after noon → 0.333; 6am next = 18h after noon → 0.75
    expect(today.segments[0].x0).toBeCloseTo(8 / 24, 3);
    expect(today.segments[0].x1).toBeCloseTo(18 / 24, 3);
    expect(today.segments[0].nap).toBe(false);
  });

  it('after noon, last night moves up a row and Today is the fresh (empty) window', () => {
    const rows = buildSleepHeatmap([sleep(at(2026, 6, 4, 20), at(2026, 6, 5, 6), false)], now); // 3pm
    expect(rows[rows.length - 1].offsetFromToday).toBe(0);
    expect(rows[rows.length - 1].segments).toHaveLength(0);
    expect(rows[rows.length - 2].offsetFromToday).toBe(1);
    expect(rows[rows.length - 2].segments).toHaveLength(1);
  });

  it('marks a daytime nap with nap=true at the right x', () => {
    const rows = buildSleepHeatmap([sleep(at(2026, 6, 5, 13), at(2026, 6, 5, 14), true)], now);
    const seg = rows[rows.length - 1].segments[0];
    expect(seg.nap).toBe(true);
    expect(seg.x0).toBeCloseTo(1 / 24, 3); // 1pm = 1h after noon
  });

  it('splits a sleep that crosses noon across two rows', () => {
    // 11am–1pm on 4 Jul crosses the noon seam → yesterday-row tail + today-row head
    const rows = buildSleepHeatmap([sleep(at(2026, 6, 4, 11), at(2026, 6, 4, 13), true)], now);
    const withSegs = rows.filter((r) => r.segments.length > 0);
    expect(withSegs).toHaveLength(2);
  });

  it('spans oldest data → today inclusive, with no rows older than the data', () => {
    const rows = buildSleepHeatmap([sleep(at(2026, 6, 3, 20), at(2026, 6, 4, 6), false)], now); // 3pm Jul 5
    expect(rows).toHaveLength(3); // offsets 2,1,0 — nothing older than the data
    expect(rows[0].segments).toHaveLength(1);
    expect(rows[2].segments).toHaveLength(0); // today-so-far, still empty
  });

  it('returns [] when no sleep falls inside the window', () => {
    expect(buildSleepHeatmap([], now)).toEqual([]);
  });
});

it('noonWindowStart bins a pre-noon time into the previous noon', () => {
  const w = noonWindowStart(at(2026, 6, 5, 3)); // 3am 5 Jul → noon 4 Jul
  expect(new Date(w).getDate()).toBe(4);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/insights/compute.test.ts`
Expected: FAIL — "Failed to resolve import './compute'" / functions not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/features/insights/compute.ts
import type { Entry } from '@/types/models';

export const DAY = 86400000;

/** Local midnight (ms) of the calendar day containing `ms`. */
export function dayStart(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Start (local noon) of the noon-to-noon window containing `ms`. */
export function noonWindowStart(ms: number): number {
  const d = new Date(ms);
  const noon = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime();
  return ms >= noon ? noon : noon - DAY;
}

export interface HeatSegment { x0: number; x1: number; nap: boolean }
export interface HeatRow { offsetFromToday: number; segments: HeatSegment[] }

/**
 * One row per noon-to-noon window, newest last. x is noon-origin in [0,1):
 * 0 = noon, 0.5 = midnight, 1 = next noon — so a night is a single contiguous
 * block centred in the row. The bottom row (offsetFromToday 0) is the current,
 * still-filling window: after today's noon it starts fresh and last night sits
 * one row up. Rows span the oldest in-range data window through today
 * inclusive — interior gap days render as empty rows, nothing older than the
 * data is padded, and [] is returned when no sleep falls in range. Sleeps
 * crossing clock-noon spill into two rows.
 */
export function buildSleepHeatmap(entries: Entry[], now: number, days = 28): HeatRow[] {
  const todayWin = noonWindowStart(now);
  const rows = new Map<number, HeatSegment[]>();
  let oldest = -1;
  for (const e of entries) {
    if (e.type !== 'sleep' || e.end == null) continue;
    let start = e.start;
    const end = e.end;
    while (start < end) {
      const win = noonWindowStart(start);
      const segEnd = Math.min(end, win + DAY);
      const offset = Math.round((todayWin - win) / DAY);
      if (offset >= 0 && offset < days) {
        const x0 = (start - win) / DAY;
        const x1 = (segEnd - win) / DAY;
        if (x1 - x0 > 0.001) {
          const arr = rows.get(offset) ?? [];
          arr.push({ x0, x1, nap: e.nap });
          rows.set(offset, arr);
          if (offset > oldest) oldest = offset;
        }
      }
      start = segEnd;
    }
  }
  if (oldest < 0) return [];
  const out: HeatRow[] = [];
  for (let offset = oldest; offset >= 0; offset--) {
    out.push({ offsetFromToday: offset, segments: rows.get(offset) ?? [] });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/insights/compute.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/insights/compute.ts src/features/insights/compute.test.ts
git commit -m "feat(insights): sleep-rhythm heatmap computation"
```

---

## Task 2: Pure trend computation

**Files:**
- Modify: `src/features/insights/compute.ts`
- Test: `src/features/insights/compute.test.ts`

**Interfaces:**
- Produces: `TrendMetric` (`'totalSleep'|'longestStretch'|'wakeWindow'|'feedsPerDay'|'feedInterval'`), `TrendPoint {t:number; value:number}`, `buildTrend(entries, metric, now, rangeDays): TrendPoint[]` (points sorted ascending by `t`; sleep metrics bucketed noon-to-noon, feeding metrics by calendar day; days without relevant data are omitted). Sleep durations in **hours**, wake window in **minutes**, feed interval in **hours**, feeds/day a **count**.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/features/insights/compute.test.ts
import { buildTrend } from './compute';

const feeding = (start: number): Entry => ({
  id: `f-${start}`, childId: 'c1', type: 'feeding', start, end: start + 900000,
  feedType: 'breast', method: 'left', amount: null, tags: [],
});

describe('buildTrend', () => {
  const now = at(2026, 6, 5, 15);

  it('totalSleep sums a night’s sleep into one noon-to-noon point (hours)', () => {
    const pts = buildTrend(
      [sleep(at(2026, 6, 4, 20), at(2026, 6, 4, 23), false), sleep(at(2026, 6, 5, 1), at(2026, 6, 5, 6), false)],
      'totalSleep', now, 30,
    );
    expect(pts).toHaveLength(1);
    expect(pts[0].value).toBeCloseTo(8, 1); // 3h + 5h in the same night window
  });

  it('longestStretch reports the single longest sleep of the night (hours)', () => {
    const pts = buildTrend(
      [sleep(at(2026, 6, 4, 20), at(2026, 6, 4, 22), false), sleep(at(2026, 6, 5, 0), at(2026, 6, 5, 6), false)],
      'longestStretch', now, 30,
    );
    expect(pts[0].value).toBeCloseTo(6, 1);
  });

  it('feedsPerDay counts feedings within a calendar day', () => {
    const day = at(2026, 6, 5, 8);
    const pts = buildTrend([feeding(day), feeding(day + 3600000), feeding(day + 7200000)], 'feedsPerDay', now, 30);
    expect(pts[0].value).toBe(3);
  });

  it('feedInterval averages gaps between consecutive feeds (hours)', () => {
    const day = at(2026, 6, 5, 8);
    const pts = buildTrend([feeding(day), feeding(day + 2 * 3600000), feeding(day + 4 * 3600000)], 'feedInterval', now, 30);
    expect(pts[0].value).toBeCloseTo(2, 2);
  });

  it('omits entries older than the range', () => {
    const pts = buildTrend([feeding(at(2026, 5, 1, 8))], 'feedsPerDay', now, 14);
    expect(pts).toHaveLength(0);
  });

  it('wakeWindow averages awake gaps between sleeps in a night window (minutes)', () => {
    const pts = buildTrend(
      [
        sleep(at(2026, 6, 4, 20), at(2026, 6, 4, 22), false),
        sleep(at(2026, 6, 4, 23), at(2026, 6, 5, 1), false),
        sleep(at(2026, 6, 5, 2, 30), at(2026, 6, 5, 6), false),
      ],
      'wakeWindow', now, 30,
    );
    expect(pts).toHaveLength(1);
    expect(pts[0].value).toBeCloseTo(75, 1); // gaps of 60m and 90m → avg 75m
  });

  it('wakeWindow ignores gaps ≥6h and omits windows with no valid gap', () => {
    // single sleep → no gaps → window omitted
    expect(buildTrend([sleep(at(2026, 6, 4, 20), at(2026, 6, 5, 6), false)], 'wakeWindow', now, 30)).toHaveLength(0);
    // two sleeps 8h apart → gap filtered as an outlier → window omitted
    expect(
      buildTrend(
        [sleep(at(2026, 6, 3, 13), at(2026, 6, 3, 14), true), sleep(at(2026, 6, 3, 22), at(2026, 6, 4, 6), false)],
        'wakeWindow', now, 30,
      ),
    ).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/insights/compute.test.ts -t buildTrend`
Expected: FAIL — `buildTrend` is not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to src/features/insights/compute.ts
export type TrendMetric = 'totalSleep' | 'longestStretch' | 'wakeWindow' | 'feedsPerDay' | 'feedInterval';
export interface TrendPoint { t: number; value: number }
const HOUR = 3600000;

export function buildTrend(entries: Entry[], metric: TrendMetric, now: number, rangeDays: number): TrendPoint[] {
  const cutoff = now - rangeDays * DAY;

  if (metric === 'feedsPerDay' || metric === 'feedInterval') {
    const byDay = new Map<number, number[]>();
    for (const e of entries) {
      if (e.type !== 'feeding' || e.start < cutoff) continue;
      const d = dayStart(e.start);
      (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(e.start);
    }
    const out: TrendPoint[] = [];
    for (const [d, starts] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
      if (metric === 'feedsPerDay') { out.push({ t: d, value: starts.length }); continue; }
      if (starts.length < 2) continue;
      starts.sort((a, b) => a - b);
      let sum = 0;
      for (let i = 1; i < starts.length; i++) sum += starts[i] - starts[i - 1];
      out.push({ t: d, value: sum / (starts.length - 1) / HOUR });
    }
    return out;
  }

  const byWin = new Map<number, { start: number; end: number }[]>();
  for (const e of entries) {
    if (e.type !== 'sleep' || e.end == null || e.end < cutoff) continue;
    const w = noonWindowStart(e.start);
    (byWin.get(w) ?? byWin.set(w, []).get(w)!).push({ start: e.start, end: e.end });
  }
  const out: TrendPoint[] = [];
  for (const [w, sleeps] of [...byWin.entries()].sort((a, b) => a[0] - b[0])) {
    sleeps.sort((a, b) => a.start - b.start);
    if (metric === 'totalSleep') {
      out.push({ t: w, value: sleeps.reduce((s, x) => s + (x.end - x.start), 0) / HOUR });
    } else if (metric === 'longestStretch') {
      out.push({ t: w, value: Math.max(...sleeps.map((x) => x.end - x.start)) / HOUR });
    } else {
      const gaps: number[] = [];
      for (let i = 1; i < sleeps.length; i++) {
        const gap = sleeps[i].start - sleeps[i - 1].end;
        if (gap > 0 && gap < 6 * HOUR) gaps.push(gap);
      }
      if (gaps.length) out.push({ t: w, value: gaps.reduce((s, g) => s + g, 0) / gaps.length / 60000 });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/insights/compute.test.ts`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/insights/compute.ts src/features/insights/compute.test.ts
git commit -m "feat(insights): trend-series computation for sleep and feeding"
```

---

## Task 3: Pure diaper-series computation

**Files:**
- Modify: `src/features/insights/compute.ts`
- Test: `src/features/insights/compute.test.ts`

**Interfaces:**
- Produces: `DiaperDay {t:number; wet:number; dirty:number}`, `buildDiaperSeries(entries, now, rangeDays): DiaperDay[]`. Wet and dirty counted **independently** — a both-diaper is `+1` to each; the two are never summed.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/features/insights/compute.test.ts
import { buildDiaperSeries } from './compute';

const diaper = (time: number, wet: boolean, solid: boolean): Entry => ({
  id: `d-${time}`, childId: 'c1', type: 'diaper', time, wet, solid, color: null, tags: [],
});

describe('buildDiaperSeries', () => {
  const now = at(2026, 6, 5, 15);
  const day = at(2026, 6, 5, 9);

  it('counts a both-wet-and-dirty change once in each series, never summed', () => {
    const s = buildDiaperSeries([diaper(day, true, true)], now, 14);
    expect(s[0].wet).toBe(1);
    expect(s[0].dirty).toBe(1);
  });

  it('tallies wet-only and dirty-only independently within a day', () => {
    const s = buildDiaperSeries(
      [diaper(day, true, false), diaper(day + 3600000, true, false), diaper(day + 7200000, false, true)],
      now, 14,
    );
    expect(s[0].wet).toBe(2);
    expect(s[0].dirty).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/insights/compute.test.ts -t buildDiaperSeries`
Expected: FAIL — `buildDiaperSeries` is not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to src/features/insights/compute.ts
export interface DiaperDay { t: number; wet: number; dirty: number }

export function buildDiaperSeries(entries: Entry[], now: number, rangeDays: number): DiaperDay[] {
  const cutoff = now - rangeDays * DAY;
  const byDay = new Map<number, { wet: number; dirty: number }>();
  for (const e of entries) {
    if (e.type !== 'diaper' || e.time < cutoff) continue;
    const d = dayStart(e.time);
    const cur = byDay.get(d) ?? { wet: 0, dirty: 0 };
    if (e.wet) cur.wet += 1;   // wet and dirty are independent signals —
    if (e.solid) cur.dirty += 1; // a both-diaper increments each, never their sum
    byDay.set(d, cur);
  }
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, wet: v.wet, dirty: v.dirty }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/insights/compute.test.ts`
Expected: PASS (all compute tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/insights/compute.ts src/features/insights/compute.test.ts
git commit -m "feat(insights): diaper wet/dirty two-series computation"
```

---

## Task 4: Normative reference data + age-tracking bands

**Files:**
- Create: `src/features/insights/norms.ts`
- Test: `src/features/insights/norms.test.ts`

**Interfaces:**
- Consumes: `TrendMetric` from `./compute`.
- Produces: `NormKind`, `NormBucket`, `Norm`, `NORMS: Record<TrendMetric | 'wet' | 'dirty', Norm>`, `Band {lo:number[]; hi:number[]}`, `bandForRange(norm, birthMs, points): Band | null` (per-point lo/hi from the baby's age at each point; steps at bucket boundaries; `null` for `kind:'none'`).

- [ ] **Step 1: Write the failing test**

```ts
// src/features/insights/norms.test.ts
import { describe, expect, it } from 'vitest';
import { NORMS, bandForRange } from './norms';

const DAY = 86400000;

describe('bandForRange', () => {
  const birth = new Date(2026, 0, 1).getTime();

  it('steps the total-sleep band down as the baby crosses 90 days', () => {
    const young = birth + 30 * DAY;   // ~1 mo → 14–17
    const older = birth + 200 * DAY;  // ~6.5 mo → 12–16
    const band = bandForRange(NORMS.totalSleep, birth, [{ t: young }, { t: older }])!;
    expect(band.hi[0]).toBe(17);
    expect(band.lo[0]).toBe(14);
    expect(band.hi[1]).toBe(16);
    expect(band.lo[1]).toBe(12);
  });

  it('returns null for a metric with no norm (dirty)', () => {
    expect(bandForRange(NORMS.dirty, birth, [{ t: birth + 40 * DAY }])).toBeNull();
  });

  it('clamps ages beyond the last bucket to that bucket', () => {
    const band = bandForRange(NORMS.totalSleep, birth, [{ t: birth + 5000 * DAY }])!;
    expect(band.lo[0]).toBe(11);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/insights/norms.test.ts`
Expected: FAIL — "Failed to resolve import './norms'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/features/insights/norms.ts
import type { TrendMetric } from './compute';

const DAY = 86400000;

export type NormKind = 'band' | 'floor' | 'ruleOfThumb' | 'none';
export interface NormBucket { maxAgeDays: number; lo: number; hi?: number }
export interface Norm {
  kind: NormKind;
  unit: string;
  buckets: NormBucket[];
  source: string;
  disclaimer: string;
}

const DISCLAIMER = 'General guidance, not medical advice. Ranges vary widely — ask your pediatrician.';

// Sources documented inline. Bands are population ranges, deliberately wide.
export const NORMS: Record<TrendMetric | 'wet' | 'dirty', Norm> = {
  // National Sleep Foundation / AASM total sleep incl. naps.
  totalSleep: { kind: 'band', unit: 'h', source: 'National Sleep Foundation / AASM', disclaimer: DISCLAIMER,
    buckets: [{ maxAgeDays: 90, lo: 14, hi: 17 }, { maxAgeDays: 365, lo: 12, hi: 16 }, { maxAgeDays: 730, lo: 11, hi: 14 }] },
  // AAP general feeding frequency guidance.
  feedsPerDay: { kind: 'band', unit: '/day', source: 'AAP general feeding guidance', disclaimer: DISCLAIMER,
    buckets: [{ maxAgeDays: 30, lo: 8, hi: 12 }, { maxAgeDays: 90, lo: 7, hi: 9 }, { maxAgeDays: 180, lo: 5, hi: 7 }, { maxAgeDays: 365, lo: 4, hi: 6 }] },
  // AAP hydration: ~6+ wet/day after the first week. Floor line, no upper bound.
  wet: { kind: 'floor', unit: '/day', source: 'AAP hydration guidance', disclaimer: DISCLAIMER,
    buckets: [{ maxAgeDays: 5, lo: 4 }, { maxAgeDays: 3650, lo: 6 }] },
  // Sleep-consultant rules of thumb — NOT medical consensus.
  wakeWindow: { kind: 'ruleOfThumb', unit: 'min', source: 'Common sleep-consultant guidance', disclaimer: DISCLAIMER,
    buckets: [{ maxAgeDays: 30, lo: 45, hi: 60 }, { maxAgeDays: 90, lo: 60, hi: 90 }, { maxAgeDays: 180, lo: 90, hi: 120 }, { maxAgeDays: 365, lo: 120, hi: 180 }] },
  longestStretch: { kind: 'ruleOfThumb', unit: 'h', source: 'Common sleep-consultant guidance', disclaimer: DISCLAIMER,
    buckets: [{ maxAgeDays: 30, lo: 2, hi: 4 }, { maxAgeDays: 90, lo: 4, hi: 6 }, { maxAgeDays: 180, lo: 6, hi: 9 }, { maxAgeDays: 365, lo: 8, hi: 11 }] },
  feedInterval: { kind: 'none', unit: 'h', source: '', disclaimer: DISCLAIMER, buckets: [] },
  dirty: { kind: 'none', unit: '/day', source: '', disclaimer: DISCLAIMER, buckets: [] },
};

function bucketFor(norm: Norm, ageDays: number): NormBucket | null {
  if (!norm.buckets.length) return null;
  for (const b of norm.buckets) if (ageDays <= b.maxAgeDays) return b;
  return norm.buckets[norm.buckets.length - 1];
}

export interface Band { lo: number[]; hi: number[] }

export function bandForRange(norm: Norm, birthMs: number, points: { t: number }[]): Band | null {
  if (norm.kind === 'none' || !points.length) return null;
  const lo: number[] = [], hi: number[] = [];
  for (const p of points) {
    const b = bucketFor(norm, (p.t - birthMs) / DAY);
    if (!b) return null;
    lo.push(b.lo);
    hi.push(b.hi ?? b.lo);
  }
  return { lo, hi };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/insights/norms.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/insights/norms.ts src/features/insights/norms.test.ts
git commit -m "feat(insights): cited age-tracking normative bands"
```

---

## Task 5: API pagination + deep-history repository loader

**Files:**
- Modify: `src/api/client.ts` (add `offset` to `listSleep`, `listFeedings`, `listChanges`)
- Modify: `src/data/repository.ts` (add `loadInsightsHistory`)
- Test: `src/data/repository.test.ts` (add cases; file may need creating if absent — check first)

**Interfaces:**
- Consumes: `BabybuddyClient`, `Connection`, `entryTimestamp` from `@/lib/activities`.
- Produces: `loadInsightsHistory(conn, childId, sinceMs): Promise<Entry[]>` — sleep+feedings+changes back to `sinceMs`, paginated; demo returns `[]` (store supplies demo data from seed); a first-page failure degrades that type to `[]`, a later-page failure keeps the already-fetched newest pages (oldest end truncated only).

- [ ] **Step 1: Write the failing test**

Check whether `src/data/repository.test.ts` exists; if not, create it. Add:

```ts
// src/data/repository.test.ts
import { describe, expect, it, vi } from 'vitest';

const DAY = 86400000;

// Mock the client so no network is touched.
const listSleep = vi.fn();
const listFeedings = vi.fn();
const listChanges = vi.fn();
vi.mock('@/api/client', () => ({
  BabybuddyClient: vi.fn().mockImplementation(() => ({ listSleep, listFeedings, listChanges })),
  normalizeServerUrl: (s: string) => s,
}));

import { loadInsightsHistory } from './repository';

const sleepEntry = (start: number) => ({ id: `s-${start}`, type: 'sleep', childId: 'c1', start, end: start + 3600000, nap: false, tags: [] });

describe('loadInsightsHistory', () => {
  it('pages until entries fall before the cutoff and trims them', async () => {
    const now = Date.now();
    // page 1 = 100 recent, page 2 = 100 that cross the cutoff
    listSleep.mockReset();
    listSleep
      .mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => sleepEntry(now - i * 3600000)))
      .mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => sleepEntry(now - (100 + i) * DAY)));
    listFeedings.mockResolvedValue([]);
    listChanges.mockResolvedValue([]);

    const out = await loadInsightsHistory({ demo: false, serverUrl: 'x', token: 'y' }, 'c1', now - 90 * DAY);
    expect(out.every((e) => e.start >= now - 90 * DAY)).toBe(true);
    expect(listSleep).toHaveBeenCalledWith('c1', 100, 0);
    expect(listSleep).toHaveBeenCalledWith('c1', 100, 100);
  });

  it('returns [] in demo mode without calling the client', async () => {
    listSleep.mockClear();
    const out = await loadInsightsHistory({ demo: true, serverUrl: '', token: '' }, 'c1', 0);
    expect(out).toEqual([]);
    expect(listSleep).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/repository.test.ts`
Expected: FAIL — `loadInsightsHistory` is not exported.

- [ ] **Step 3a: Add `offset` to the three client list methods**

In `src/api/client.ts`, change each of `listSleep`, `listFeedings`, `listChanges` to accept an offset and append it to the query. Example for `listSleep` (apply the same shape to the other two, using their existing `ordering` field):

```ts
  async listSleep(childId: string, limit = 50, offset = 0): Promise<SleepEntry[]> {
    const data = await this.request<Paginated<any>>(
      `/sleep/?child=${childId}&ordering=-start&limit=${limit}&offset=${offset}`,
    );
    // ...unchanged mapping...
  }
```

`listFeedings` uses `ordering=-start`; `listChanges` uses `ordering=-time`. Leave `listPumping`/`listTummy` unchanged.

- [ ] **Step 3b: Add `loadInsightsHistory` to the repository**

```ts
// src/data/repository.ts — add near the other loaders
import { entryTimestamp } from '@/lib/activities';

/**
 * Fetch the charted history (sleep + feedings + diapers) back to `sinceMs`
 * using LimitOffset pagination. Demo mode returns [] — the store supplies demo
 * history from the local seed. A failed first page degrades that type to [];
 * a failed later page keeps the newest pages already fetched (the range is
 * truncated at the oldest end only).
 */
export async function loadInsightsHistory(
  conn: Connection,
  childId: string,
  sinceMs: number,
): Promise<Entry[]> {
  if (conn.demo || !childId) return [];
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  const LIMIT = 100;
  const MAX_PAGES = 20; // hard backstop: ≤2000 entries/type

  const pageAll = async (fetch: (limit: number, offset: number) => Promise<Entry[]>): Promise<Entry[]> => {
    const acc: Entry[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await fetch(LIMIT, page * LIMIT).catch(() => [] as Entry[]);
      acc.push(...batch);
      if (batch.length < LIMIT) break;
      if (entryTimestamp(batch[batch.length - 1]) < sinceMs) break;
    }
    return acc.filter((e) => entryTimestamp(e) >= sinceMs);
  };

  const [s, f, d] = await Promise.all([
    pageAll((l, o) => client.listSleep(childId, l, o)),
    pageAll((l, o) => client.listFeedings(childId, l, o)),
    pageAll((l, o) => client.listChanges(childId, l, o)),
  ]);
  return [...s, ...f, ...d];
}
```

Confirm `Entry` and `Connection` are already imported in `repository.ts` (they are).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/repository.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/api/client.ts src/data/repository.ts src/data/repository.test.ts
git commit -m "feat(insights): paginated deep-history loader"
```

---

## Task 6: Store slice + lazy load action

**Files:**
- Modify: `src/store/useAppStore.ts`
- Test: `src/store/useAppStore.test.ts` (add cases)

**Interfaces:**
- Consumes: `loadInsightsHistory` (Task 5), `seed` (already imported), `Entry`.
- Produces store state/actions: `insightsEntries: Entry[]`, `insightsLoaded: boolean`, `insightsLoading: boolean`, `insightsError: boolean`, `loadInsights(): Promise<void>`. `selectChild` now also resets `insightsLoaded`/`insightsEntries`.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/store/useAppStore.test.ts (match the file's existing import of useAppStore)
import { describe, expect, it, vi } from 'vitest';
import { useAppStore } from './useAppStore';

describe('insights slice', () => {
  it('loadInsights in demo mode fills insightsEntries from local entries', async () => {
    useAppStore.setState({
      connection: { demo: true, serverUrl: '', token: '' } as any,
      selectedChildId: 'c1',
      entries: [{ id: 's1', type: 'sleep', childId: 'c1', start: 1, end: 2, nap: false, tags: [] } as any],
      insightsLoaded: false, insightsLoading: false, insightsEntries: [], insightsError: false,
    });
    await useAppStore.getState().loadInsights();
    const s = useAppStore.getState();
    expect(s.insightsLoaded).toBe(true);
    expect(s.insightsEntries.length).toBeGreaterThan(0);
  });

  it('selectChild resets the insights cache', () => {
    useAppStore.setState({ insightsLoaded: true, insightsEntries: [{ id: 'x' } as any] });
    useAppStore.getState().selectChild('c2');
    expect(useAppStore.getState().insightsLoaded).toBe(false);
    expect(useAppStore.getState().insightsEntries).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/useAppStore.test.ts -t 'insights slice'`
Expected: FAIL — `loadInsights` is not a function / fields undefined.

- [ ] **Step 3a: Add state fields**

In the state interface (near `measurements: Measurement[];`, ~line 91) add:

```ts
  insightsEntries: Entry[];
  insightsLoaded: boolean;
  insightsLoading: boolean;
  insightsError: boolean;
  loadInsights: () => Promise<void>;
```

In the initial state (near `measurements: [],`, ~line 227) add:

```ts
  insightsEntries: [],
  insightsLoaded: false,
  insightsLoading: false,
  insightsError: false,
```

- [ ] **Step 3b: Reset the cache on child switch**

Change `selectChild` (line 479) from:

```ts
  selectChild: (id) => set({ selectedChildId: id, showChildSwitcher: false }),
```

to:

```ts
  selectChild: (id) =>
    set({ selectedChildId: id, showChildSwitcher: false, insightsLoaded: false, insightsEntries: [] }),
```

- [ ] **Step 3c: Add the `loadInsights` action**

Add alongside the other actions (e.g. after `selectChild`). Import `loadInsightsHistory` from `@/data/repository` at the top (the file already imports `loadFromServer` from there — extend that import).

```ts
  loadInsights: async () => {
    const s = get();
    if (s.insightsLoaded || s.insightsLoading) return;
    const conn = s.connection;
    const childId = s.selectedChildId;
    if (!conn || !childId) return;
    set({ insightsLoading: true, insightsError: false });
    try {
      // Demo: the store's `entries` already hold the full local seed history.
      const entries = conn.demo ? s.entries : await loadInsightsHistory(conn, childId, s.now - 90 * 86400000);
      set({ insightsEntries: entries, insightsLoaded: true, insightsLoading: false });
    } catch {
      set({ insightsLoading: false, insightsError: true });
    }
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store/useAppStore.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/store/useAppStore.ts src/store/useAppStore.test.ts
git commit -m "feat(insights): store slice with lazy deep-history load"
```

---

## Task 7: Navigation registration, icon, and reachable skeleton screen

**Files:**
- Modify: `src/components/Icon.tsx`
- Modify: `src/app/(tabs)/_layout.tsx`
- Modify: `src/components/TabBar.tsx`
- Modify: `src/shell/Sidebar.tsx`
- Modify: `src/shell/labels.ts`
- Modify: `src/shell/labels.test.ts`
- Create: `src/app/(tabs)/insights.tsx`

**Interfaces:**
- Consumes: `useAppStore` (`loadInsights`, child, `openSwitcher`), `DesktopPage`, `useDesktopShell`.
- Produces: a reachable `/insights` route; the screen calls `loadInsights()` on focus and renders a header + empty body (sections land in Tasks 8–11).

- [ ] **Step 1: Write the failing test** (label helper)

```ts
// append to src/shell/labels.test.ts
import { screenTitleFor } from './labels';
it('titles the insights route', () => {
  expect(screenTitleFor('/insights')).toBe('Insights');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shell/labels.test.ts`
Expected: FAIL — returns "Budkin" (default), not "Insights".

- [ ] **Step 3a: Label**

In `src/shell/labels.ts` `screenTitleFor`, add before `default`:

```ts
    case '/insights':
      return 'Insights';
```

- [ ] **Step 3b: Icon** — add `'insights'` to the `IconName` union in `src/components/Icon.tsx` and render a three-bar glyph. In the union add `| 'insights'`; in the glyph switch/map add (matching the file's existing `Path`/`Rect` render style, stroked UI-icon treatment):

```tsx
// a rising three-bar chart, distinct from `chart`
case 'insights':
  return (
    <>
      <Rect x={4} y={12} width={3.4} height={8} rx={1.4} fill={color} />
      <Rect x={10.3} y={7} width={3.4} height={13} rx={1.4} fill={color} />
      <Rect x={16.6} y={9.5} width={3.4} height={10.5} rx={1.4} fill={color} />
    </>
  );
```

(Adapt to the file's actual return structure — if icons are entries in a map rather than a switch, add an `insights` key with the same shapes.)

- [ ] **Step 3c: Register the tab route** — in `src/app/(tabs)/_layout.tsx` add after the growth screen:

```tsx
      <Tabs.Screen name="insights" options={{ title: 'Insights' }} />
```

- [ ] **Step 3d: Phone tab bar** — in `src/components/TabBar.tsx` add to the `TABS` record:

```ts
  insights: { label: 'Insights', icon: 'insights' },
```

- [ ] **Step 3e: Desktop sidebar** — in `src/shell/Sidebar.tsx` add to `NAV` before the Settings item:

```ts
  { label: 'Insights', icon: 'insights', href: '/insights', match: (p) => p.startsWith('/insights') },
```

- [ ] **Step 3f: Skeleton screen** — create `src/app/(tabs)/insights.tsx`:

```tsx
import { useEffect } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { isHovered } from '@/components/hover';
import { Txt } from '@/components/Txt';
import { DesktopPage } from '@/shell/DesktopPage';
import { useDesktopShell } from '@/shell/useDesktopShell';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

export default function Insights() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const desktop = useDesktopShell();
  const child = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId));
  const openSwitcher = useAppStore((s) => s.openSwitcher);
  const loadInsights = useAppStore((s) => s.loadInsights);

  useEffect(() => { loadInsights(); }, [loadInsights]);

  const body = <View />; // sections added in Tasks 8–11

  if (desktop) return <DesktopPage maxWidth={640}>{body}</DesktopPage>;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: 24 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2, paddingTop: 4, paddingBottom: 16 }}>
        <Txt weight={800} size={27} tracking={-0.6}>Insights</Txt>
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

- [ ] **Step 4: Verify**

Run: `npx vitest run src/shell/labels.test.ts` → PASS.
Run: `npm run lint` → no new errors.
Manual: `npm start`, open the app; confirm a 5th **Insights** tab appears on phone and in the desktop sidebar, navigates, shows the header, and (with a real server) fires the network load once.

- [ ] **Step 5: Commit**

```bash
git add src/components/Icon.tsx src/app/"(tabs)"/_layout.tsx src/components/TabBar.tsx src/shell/Sidebar.tsx src/shell/labels.ts src/shell/labels.test.ts src/app/"(tabs)"/insights.tsx
git commit -m "feat(insights): register tab, icon, and skeleton screen"
```

---

## Task 8: SleepHeatmap component + SLEEP heatmap card

**Files:**
- Create: `src/features/insights/SleepHeatmap.tsx`
- Modify: `src/app/(tabs)/insights.tsx`

**Interfaces:**
- Consumes: `HeatRow` (Task 1), `useTheme`, `hexA`.
- Produces: `<SleepHeatmap rows={HeatRow[]} width={number} />` — the grid + hour axis + day labels (no card chrome).

- [ ] **Step 1: Implement the component**

```tsx
// src/features/insights/SleepHeatmap.tsx
import { Fragment } from 'react';
import { View } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';

import { hexA } from '@/lib/color';
import { useTheme } from '@/theme/useTheme';
import type { HeatRow } from './compute';

const HOUR_TICKS: [string, number][] = [['12 PM', 0], ['6 PM', 6], ['12 AM', 12], ['6 AM', 18], ['12 PM', 24]];
const DAY_LABELS: Record<number, string> = { 0: 'Today', 7: '1w', 14: '2w', 21: '3w', 27: '4w' };

export function SleepHeatmap({ rows, width }: { rows: HeatRow[]; width: number }) {
  const t = useTheme();
  if (width <= 0 || rows.length === 0) return null;

  const night = t.activity.sleep;
  const nap = hexA(t.activity.sleep, t.dark ? 0.5 : 0.42);
  const gutter = 30, rightPad = 6, top = 8, axisH = 20, pitch = 8, rowH = 6.4;
  const gx = gutter, gw = Math.max(0, width - gutter - rightPad);
  const gh = rows.length * pitch;
  const height = top + gh + axisH;
  const xAt = (h: number) => gx + (h / 24) * gw;

  return (
    <View>
      <Svg width={width} height={height}>
        {HOUR_TICKS.map(([, h], i) => (
          <Line key={`g${i}`} x1={xAt(h)} y1={top} x2={xAt(h)} y2={top + gh} stroke={t.line} strokeWidth={1} opacity={h === 12 ? 1 : 0.5} />
        ))}
        {rows.map((r, idx) => {
          const y = top + idx * pitch;
          return (
            <Fragment key={idx}>
              <Rect x={gx} y={y} width={gw} height={rowH} rx={1.5} fill={t.chip} />
              {r.segments.map((s, j) => (
                <Rect key={j} x={gx + s.x0 * gw} y={y} width={Math.max(0, (s.x1 - s.x0) * gw)} height={rowH} rx={1.6} fill={s.nap ? nap : night} />
              ))}
              {DAY_LABELS[r.offsetFromToday] ? (
                <SvgText x={gx - 8} y={y + rowH} fontSize={9.5} fontWeight="600" fill={t.faint} textAnchor="end">
                  {DAY_LABELS[r.offsetFromToday]}
                </SvgText>
              ) : null}
            </Fragment>
          );
        })}
        {HOUR_TICKS.map(([lbl, h], i) => (
          <SvgText key={`l${i}`} x={xAt(h)} y={top + gh + 15} fontSize={9.5} fontWeight="600" fill={t.faint} textAnchor="middle">
            {lbl}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}
```

- [ ] **Step 2: Wire it into the screen** — in `src/app/(tabs)/insights.tsx`:

Add imports:
```tsx
import { useMemo, useState } from 'react';
import { buildSleepHeatmap } from '@/features/insights/compute';
import { SleepHeatmap } from '@/features/insights/SleepHeatmap';
import { hexA } from '@/lib/color';
```

Add selectors + width state in the component:
```tsx
  const now = useAppStore((s) => s.now);
  const entries = useAppStore((s) => s.insightsEntries);
  const [width, setWidth] = useState(0);
  const heatRows = useMemo(() => buildSleepHeatmap(entries, now, 28), [entries, now]);
```

Replace `const body = <View />;` with a measured container that renders the SLEEP label + heatmap card:
```tsx
  const body = (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Txt weight={800} size={12} color={t.faint} tracking={1.4} style={{ marginHorizontal: 2, marginBottom: 10, textTransform: 'uppercase' }}>
        Sleep
      </Txt>
      <View style={{ backgroundColor: t.surface, borderWidth: 1.4, borderColor: t.line, borderRadius: 20, padding: 15 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <Txt weight={700} size={16}>Sleep rhythm</Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 9, height: 9, borderRadius: 9, backgroundColor: t.activity.sleep }} />
              <Txt weight={600} size={11} color={t.dim}>Night</Txt>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 9, height: 9, borderRadius: 9, backgroundColor: hexA(t.activity.sleep, t.dark ? 0.5 : 0.42) }} />
              <Txt weight={600} size={11} color={t.dim}>Nap</Txt>
            </View>
          </View>
        </View>
        <Txt weight={500} size={11.5} color={t.dim} style={{ marginBottom: 6 }}>Last 4 weeks · midnight-centred</Txt>
        <SleepHeatmap rows={heatRows} width={width - 30} />
      </View>
    </View>
  );
```

- [ ] **Step 3: Verify**

Run: `npm run lint` → clean.
Manual (demo mode has enough seed history): open Insights; confirm the heatmap renders — night block centred, naps lighter, day labels on the left, hour labels beneath.

- [ ] **Step 4: Commit**

```bash
git add src/features/insights/SleepHeatmap.tsx src/app/"(tabs)"/insights.tsx
git commit -m "feat(insights): sleep-rhythm heatmap card"
```

---

## Task 9: TrendChart + TrendCard + range selector + SLEEP trend cards

**Files:**
- Create: `src/features/insights/TrendChart.tsx`
- Create: `src/features/insights/TrendCard.tsx`
- Modify: `src/app/(tabs)/insights.tsx`

**Interfaces:**
- Consumes: `TrendPoint`, `TrendMetric`, `buildTrend`; `Band`, `Norm`, `bandForRange`, `NORMS`; `useTheme`, `hexA`, `useAppStore` (child birth).
- Produces:
  - `<TrendChart points band color ruleOfThumb yTicks fmtY width />`
  - `<TrendCard label color metric unit value delta good caption norm birth points width />`
  - A range selector (local state: 14 / 30 / 90 days) governing the trend cards only.

- [ ] **Step 1: Implement `TrendChart`**

```tsx
// src/features/insights/TrendChart.tsx
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { hexA } from '@/lib/color';
import { useTheme } from '@/theme/useTheme';
import type { TrendPoint } from './compute';
import type { Band } from './norms';

export function TrendChart({ points, band, color, ruleOfThumb, yTicks, fmtY, width }: {
  points: TrendPoint[]; band: Band | null; color: string; ruleOfThumb?: boolean;
  yTicks: number[]; fmtY: (v: number) => string; width: number;
}) {
  const t = useTheme();
  if (width <= 0) return null;
  const gutter = 30, right = 6, top = 8, plotH = 96, axisH = 18;
  const gx = gutter, gw = Math.max(0, width - gutter - right);
  const height = top + plotH + axisH;
  const yMin = Math.min(...yTicks), yMax = Math.max(...yTicks);
  const yv = (v: number) => top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  const xv = (i: number) => gx + (points.length <= 1 ? 0.5 : i / (points.length - 1)) * gw;

  const area = (hi: number[], lo: number[]) => {
    let d = '';
    hi.forEach((v, i) => { d += `${i ? 'L' : 'M'} ${xv(i).toFixed(1)} ${yv(v).toFixed(1)} `; });
    for (let i = lo.length - 1; i >= 0; i--) d += `L ${xv(i).toFixed(1)} ${yv(lo[i]).toFixed(1)} `;
    return d + 'Z';
  };
  const line = points.map((p, i) => `${i ? 'L' : 'M'} ${xv(i).toFixed(1)} ${yv(p.value).toFixed(1)}`).join(' ');

  return (
    <Svg width={width} height={height}>
      {band ? (
        <Path
          d={area(band.hi, band.lo)}
          fill={hexA(color, ruleOfThumb ? 0.08 : 0.14)}
          stroke={ruleOfThumb ? color : 'none'}
          strokeWidth={ruleOfThumb ? 1 : 0}
          strokeDasharray={ruleOfThumb ? '3 3' : undefined}
          opacity={ruleOfThumb ? 0.9 : 1}
        />
      ) : null}
      {yTicks.map((v, i) => (
        <Line key={i} x1={gx} y1={yv(v)} x2={gx + gw} y2={yv(v)} stroke={t.line} strokeWidth={1} opacity={0.6} />
      ))}
      {yTicks.map((v, i) => (
        <SvgText key={`y${i}`} x={gx - 6} y={yv(v) + 3.5} fontSize={9.5} fontWeight="600" fill={t.faint} textAnchor="end">{fmtY(v)}</SvgText>
      ))}
      <SvgText x={gx} y={top + plotH + 14} fontSize={9.5} fontWeight="600" fill={t.faint} textAnchor="start">start</SvgText>
      <SvgText x={gx + gw} y={top + plotH + 14} fontSize={9.5} fontWeight="600" fill={t.faint} textAnchor="end">Today</SvgText>
      <Path d={line} fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      {points.length ? (
        <Circle cx={xv(points.length - 1)} cy={yv(points[points.length - 1].value)} r={3.6} fill={color} stroke={t.surface} strokeWidth={1.8} />
      ) : null}
    </Svg>
  );
}
```

- [ ] **Step 2: Implement `TrendCard`**

```tsx
// src/features/insights/TrendCard.tsx
import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { useTheme } from '@/theme/useTheme';
import type { TrendPoint } from './compute';
import { bandForRange, type Norm } from './norms';
import { TrendChart } from './TrendChart';

export function TrendCard({ label, color, unit, value, delta, good, caption, norm, birth, points, yTicks, fmtY, width }: {
  label: string; color: string; unit: string; value: string;
  delta?: string; good?: boolean; caption?: string;
  norm: Norm; birth: number; points: TrendPoint[];
  yTicks: number[]; fmtY: (v: number) => string; width: number;
}) {
  const t = useTheme();
  const [info, setInfo] = useState(false);
  const band = bandForRange(norm, birth, points);
  const ruleOfThumb = norm.kind === 'ruleOfThumb';

  return (
    <View style={{ backgroundColor: t.surface, borderWidth: 1.4, borderColor: t.line, borderRadius: 20, padding: 16, marginTop: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <View style={{ width: 7, height: 7, borderRadius: 7, backgroundColor: color }} />
          <Txt weight={700} size={11} color={t.dim} style={{ letterSpacing: 0.6, textTransform: 'uppercase' }}>{label}</Txt>
        </View>
        {caption ? (
          <Pressable onPress={() => setInfo(true)} accessibilityRole="button" accessibilityLabel={`${label} typical range info`} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Txt weight={600} size={11} color={ruleOfThumb ? t.faint : color}>{caption}</Txt>
            <View style={{ width: 15, height: 15, borderRadius: 15, borderWidth: 1.2, borderColor: t.faint, alignItems: 'center', justifyContent: 'center' }}>
              <Txt weight={700} size={9.5} color={t.faint}>i</Txt>
            </View>
          </Pressable>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 8, marginBottom: 6 }}>
        <Txt weight={800} size={24} tracking={-0.4}>{value}</Txt>
        {unit ? <Txt weight={600} size={13} color={t.dim}>{unit}</Txt> : null}
        {delta ? (
          <View style={{ backgroundColor: good ? hexA('#3E9E6E', 0.14) : t.chip, borderRadius: 9, paddingHorizontal: 8, paddingVertical: 2 }}>
            <Txt weight={700} size={11.5} color={good ? '#3E9E6E' : t.faint}>{delta}</Txt>
          </View>
        ) : null}
      </View>
      <TrendChart points={points} band={band} color={color} ruleOfThumb={ruleOfThumb} yTicks={yTicks} fmtY={fmtY} width={width - 32} />

      <Modal visible={info} transparent animationType="fade" onRequestClose={() => setInfo(false)}>
        <Pressable onPress={() => setInfo(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 32 }}>
          <View style={{ backgroundColor: t.surface, borderRadius: 18, padding: 20, gap: 8 }}>
            <Txt weight={700} size={15}>{label}</Txt>
            <Txt weight={500} size={13} color={t.dim}>Source: {norm.source || '—'}</Txt>
            <Txt weight={500} size={12.5} color={t.faint} style={{ lineHeight: 18 }}>{norm.disclaimer}</Txt>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
```

- [ ] **Step 3: Add the range selector + SLEEP trend cards to the screen**

In `src/app/(tabs)/insights.tsx` add imports:
```tsx
import { buildTrend } from '@/features/insights/compute';
import { NORMS } from '@/features/insights/norms';
import { TrendCard } from '@/features/insights/TrendCard';
```

Add range state + child birth:
```tsx
  const birth = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId)?.birth ?? s.now);
  const [rangeDays, setRangeDays] = useState(30);
  const RANGES: [string, number][] = [['2 weeks', 14], ['1 month', 30], ['3 months', 90]];
```

Add a `last` helper and per-metric points (inside the component, memoised on entries+range):
```tsx
  const totalSleep = useMemo(() => buildTrend(entries, 'totalSleep', now, rangeDays), [entries, now, rangeDays]);
  const longest = useMemo(() => buildTrend(entries, 'longestStretch', now, rangeDays), [entries, now, rangeDays]);
  const wake = useMemo(() => buildTrend(entries, 'wakeWindow', now, rangeDays), [entries, now, rangeDays]);
  const lastVal = (pts: { value: number }[]) => (pts.length ? pts[pts.length - 1].value : 0);
```

Render the selector just under the header (before `body`'s SLEEP label) — insert at the top of `body`'s outer `<View>`:
```tsx
      <View style={{ flexDirection: 'row', backgroundColor: t.chip, borderRadius: 12, padding: 3, marginBottom: 6 }}>
        {RANGES.map(([lbl, d]) => (
          <Pressable key={d} onPress={() => setRangeDays(d)} accessibilityRole="button" style={{ flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: rangeDays === d ? t.surface : 'transparent', alignItems: 'center' }}>
            <Txt weight={rangeDays === d ? 700 : 600} size={13} color={rangeDays === d ? t.text : t.dim}>{lbl}</Txt>
          </Pressable>
        ))}
      </View>
      <Txt weight={500} size={11} color={t.faint} style={{ marginLeft: 4, marginBottom: 14 }}>Applies to trend charts</Txt>
```

After the heatmap card, add the three sleep TrendCards:
```tsx
      <TrendCard label="Total sleep / day" color={t.activity.sleep} unit="h" value={lastVal(totalSleep).toFixed(1)}
        caption="Typical for age" norm={NORMS.totalSleep} birth={birth} points={totalSleep}
        yTicks={[10, 12, 14, 16, 18]} fmtY={(v) => `${v}h`} width={width} />
      <TrendCard label="Longest stretch / night" color={t.activity.sleep} unit="h" value={lastVal(longest).toFixed(1)}
        caption="Rule of thumb" norm={NORMS.longestStretch} birth={birth} points={longest}
        yTicks={[0, 3, 6, 9, 12]} fmtY={(v) => `${v}h`} width={width} />
      <TrendCard label="Avg wake window" color={t.activity.sleep} unit="min" value={Math.round(lastVal(wake)).toString()}
        caption="Rule of thumb" norm={NORMS.wakeWindow} birth={birth} points={wake}
        yTicks={[30, 60, 90, 120, 150]} fmtY={(v) => `${v}`} width={width} />
```

- [ ] **Step 4: Verify**

Run: `npm run lint` → clean.
Manual: open Insights (demo); confirm three sleep cards render with numbered y-axes, gridlines, a shaded band (solid for total sleep, dashed for the two rules-of-thumb), and that tapping the ⓘ opens the source/disclaimer sheet. Toggle the range selector and confirm the **trend charts** reshape but the **heatmap** does not.

- [ ] **Step 5: Commit**

```bash
git add src/features/insights/TrendChart.tsx src/features/insights/TrendCard.tsx src/app/"(tabs)"/insights.tsx
git commit -m "feat(insights): banded trend charts, range selector, sleep cards"
```

---

## Task 10: FEEDING section

**Files:**
- Modify: `src/app/(tabs)/insights.tsx`

**Interfaces:**
- Consumes: `buildTrend` (`feedsPerDay`, `feedInterval`), `NORMS`, `TrendCard`, `t.activity.feeding`.

- [ ] **Step 1: Add feeding series (memoised)**

```tsx
  const feeds = useMemo(() => buildTrend(entries, 'feedsPerDay', now, rangeDays), [entries, now, rangeDays]);
  const interval = useMemo(() => buildTrend(entries, 'feedInterval', now, rangeDays), [entries, now, rangeDays]);
```

- [ ] **Step 2: Render the FEEDING section** after the sleep cards:

```tsx
      <Txt weight={800} size={12} color={t.faint} tracking={1.4} style={{ marginHorizontal: 2, marginTop: 24, marginBottom: 2, textTransform: 'uppercase' }}>
        Feeding
      </Txt>
      <TrendCard label="Feeds / day" color={t.activity.feeding} unit="" value={Math.round(lastVal(feeds)).toString()}
        caption="Typical for age" norm={NORMS.feedsPerDay} birth={birth} points={feeds}
        yTicks={[0, 3, 6, 9, 12]} fmtY={(v) => `${v}`} width={width} />
      <TrendCard label="Avg interval between feeds" color={t.activity.feeding} unit="h" value={lastVal(interval).toFixed(1)}
        norm={NORMS.feedInterval} birth={birth} points={interval}
        yTicks={[0, 1, 2, 3, 4]} fmtY={(v) => `${v}h`} width={width} />
```

(The interval card has no `caption`/band — `NORMS.feedInterval.kind === 'none'` yields `band === null`.)

- [ ] **Step 3: Verify**

Run: `npm run lint` → clean.
Manual: FEEDING section shows two cards; feeds/day has a solid band, interval has a bare line (no band, no ⓘ).

- [ ] **Step 4: Commit**

```bash
git add src/app/"(tabs)"/insights.tsx
git commit -m "feat(insights): feeding trend section"
```

---

## Task 11: DiaperBars component + DIAPERS section

**Files:**
- Create: `src/features/insights/DiaperBars.tsx`
- Modify: `src/theme/tokens.ts` (add `insightWet`, `insightDirty`)
- Modify: `src/app/(tabs)/insights.tsx`

**Interfaces:**
- Consumes: `DiaperDay` (Task 3), `buildDiaperSeries`, `useTheme` (`t.insightWet`, `t.insightDirty`), `NORMS.wet` (floor line).
- Produces: `<DiaperBars data={DiaperDay[]} width={number} />` — grouped double bars (wet beside dirty) with a wet-floor reference line.

- [ ] **Step 1: Add theme tokens**

In `src/theme/tokens.ts` add `insightWet: string; insightDirty: string;` to the `Palette` interface, and set values in both palettes:
- NIGHT: `insightWet: '#5FB0DE'`, `insightDirty: '#C08A5A'`
- DAYLIGHT: `insightWet: '#54A6D6'`, `insightDirty: '#B27C4E'`

(Match the exact property placement/style of the existing tokens in each palette object.)

- [ ] **Step 2: Implement `DiaperBars`**

```tsx
// src/features/insights/DiaperBars.tsx
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';
import { hexA } from '@/lib/color';
import { useTheme } from '@/theme/useTheme';
import type { DiaperDay } from './compute';

export function DiaperBars({ data, width }: { data: DiaperDay[]; width: number }) {
  const t = useTheme();
  if (width <= 0 || data.length === 0) return null;
  const days = data.slice(-14);
  const left = 6, right = 6, top = 8, plotH = 78, axisH = 18;
  const bx = left, bw = Math.max(0, width - left - right);
  const height = top + plotH + axisH;
  const maxV = Math.max(3, ...days.map((d) => Math.max(d.wet, d.dirty)));
  const floor = 6; // AAP wet-diaper reference
  const slot = bw / days.length, barW = Math.min(9, slot * 0.32);
  const yv = (v: number) => top + plotH - (v / maxV) * plotH;

  return (
    <Svg width={width} height={height}>
      {floor <= maxV ? (
        <Line x1={bx} y1={yv(floor)} x2={bx + bw} y2={yv(floor)} stroke={hexA(t.insightWet, 0.6)} strokeWidth={1} strokeDasharray="3 3" />
      ) : null}
      {days.map((d, i) => {
        const cx = bx + i * slot + slot / 2;
        return (
          <Rect key={`w${i}`} x={cx - barW - 1} y={yv(d.wet)} width={barW} height={top + plotH - yv(d.wet)} rx={2} fill={t.insightWet} />
        );
      })}
      {days.map((d, i) => {
        const cx = bx + i * slot + slot / 2;
        return (
          <Rect key={`d${i}`} x={cx + 1} y={yv(d.dirty)} width={barW} height={top + plotH - yv(d.dirty)} rx={2} fill={t.insightDirty} />
        );
      })}
      <Line x1={bx} y1={top + plotH} x2={bx + bw} y2={top + plotH} stroke={t.line} strokeWidth={1} />
      <SvgText x={bx} y={top + plotH + 14} fontSize={10} fontWeight="600" fill={t.faint} textAnchor="start">2 weeks ago</SvgText>
      <SvgText x={bx + bw} y={top + plotH + 14} fontSize={10} fontWeight="600" fill={t.faint} textAnchor="end">Today</SvgText>
    </Svg>
  );
}
```

- [ ] **Step 3: Render the DIAPERS section** in `insights.tsx`:

Imports + series:
```tsx
import { buildDiaperSeries } from '@/features/insights/compute';
import { DiaperBars } from '@/features/insights/DiaperBars';
```
```tsx
  const diapers = useMemo(() => buildDiaperSeries(entries, now, rangeDays), [entries, now, rangeDays]);
```

Section markup after FEEDING:
```tsx
      <Txt weight={800} size={12} color={t.faint} tracking={1.4} style={{ marginHorizontal: 2, marginTop: 24, marginBottom: 12, textTransform: 'uppercase' }}>
        Diapers
      </Txt>
      <View style={{ backgroundColor: t.surface, borderWidth: 1.4, borderColor: t.line, borderRadius: 20, padding: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Txt weight={700} size={15}>Wet vs dirty / day</Txt>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: t.insightWet }} />
              <Txt weight={600} size={11} color={t.dim}>Wet</Txt>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: t.insightDirty }} />
              <Txt weight={600} size={11} color={t.dim}>Dirty</Txt>
            </View>
          </View>
        </View>
        <DiaperBars data={diapers} width={width - 32} />
      </View>
```

- [ ] **Step 4: Verify**

Run: `npm run lint` → clean.
Manual: DIAPERS shows grouped double bars (wet beside dirty) with the dashed wet-floor line; confirm a day logged with a both-wet-and-dirty change raises **both** bars.

- [ ] **Step 5: Commit**

```bash
git add src/features/insights/DiaperBars.tsx src/theme/tokens.ts src/app/"(tabs)"/insights.tsx
git commit -m "feat(insights): diaper wet/dirty grouped bars"
```

---

## Task 12: Empty / low-data / error states + trend deltas

**Files:**
- Modify: `src/app/(tabs)/insights.tsx`

**Interfaces:**
- Consumes: `insightsLoaded`, `insightsError` from the store; existing series.
- Produces: gated rendering — a full-tab loading/error/empty state, per-metric placeholders, a heatmap gate (≥7 rows with data), and a computed delta for the longest-stretch card.

- [ ] **Step 1: Add state selectors + helpers**

```tsx
  const loaded = useAppStore((s) => s.insightsLoaded);
  const error = useAppStore((s) => s.insightsError);
  const daysWithSleep = heatRows.filter((r) => r.segments.length > 0).length;
  const enoughForChart = (pts: unknown[]) => pts.length >= 3;
  // delta for longest stretch: last minus first in range, when there's a span
  const stretchDelta = longest.length >= 2 ? longest[longest.length - 1].value - longest[0].value : 0;
```

- [ ] **Step 2: Add the placeholder + centered-state components and gate each visual**

Add `ReactNode` to the `react` import and `Icon` to the imports in `insights.tsx`:
```tsx
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
```

Add two components at module scope (below the imports), mirroring `growth.tsx`'s empty-state language:
```tsx
function KeepLogging({ what }: { what: string }) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.surface, borderWidth: 1.4, borderColor: t.line, borderRadius: 20, padding: 20, marginTop: 12 }}>
      <Txt weight={600} size={13.5} color={t.dim} style={{ lineHeight: 20 }}>
        Keep logging — your {what} chart appears after a few days.
      </Txt>
    </View>
  );
}

function CenteredState({ title, subtitle, action }: {
  title: string; subtitle: string; action?: { label: string; onPress: () => void };
}) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24, gap: 12 }}>
      <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="insights" color={t.faint} size={34} />
      </View>
      <Txt weight={700} size={16}>{title}</Txt>
      <Txt weight={500} size={14} color={t.dim} style={{ textAlign: 'center', maxWidth: 260, lineHeight: 20 }}>{subtitle}</Txt>
      {action ? (
        <Pressable onPress={action.onPress} accessibilityRole="button" style={{ marginTop: 4, backgroundColor: t.primary, borderRadius: 14, paddingVertical: 11, paddingHorizontal: 22 }}>
          <Txt weight={700} size={14} color={t.onPrimary}>{action.label}</Txt>
        </Pressable>
      ) : null}
    </View>
  );
}
```

Add a gate helper inside the component (uses the Step 1 `enoughForChart`):
```tsx
  const gated = (pts: unknown[], what: string, node: ReactNode): ReactNode =>
    enoughForChart(pts) ? node : <KeepLogging what={what} />;
```

**Gate the heatmap** — inside the heatmap card, replace `<SleepHeatmap rows={heatRows} width={width - 30} />` with:
```tsx
        {daysWithSleep >= 7 ? (
          <SleepHeatmap rows={heatRows} width={width - 30} />
        ) : (
          <Txt weight={600} size={13} color={t.dim} style={{ paddingVertical: 18, lineHeight: 20 }}>
            Keep logging sleep — the rhythm heatmap appears after about a week.
          </Txt>
        )}
```

**Gate each TrendCard** — wrap all six card call-sites with `gated(...)`. Example for the first, then apply identically to the rest using the listed pairs:
```tsx
      {gated(totalSleep, 'total sleep', (
        <TrendCard label="Total sleep / day" color={t.activity.sleep} unit="h" value={lastVal(totalSleep).toFixed(1)}
          caption="Typical for age" norm={NORMS.totalSleep} birth={birth} points={totalSleep}
          yTicks={[10, 12, 14, 16, 18]} fmtY={(v) => `${v}h`} width={width} />
      ))}
```
Pairs to wrap: `(totalSleep, 'total sleep')`, `(longest, 'longest stretch')`, `(wake, 'wake window')`, `(feeds, 'feeds per day')`, `(interval, 'feed interval')`. The DIAPERS card gates on `diapers.length >= 3` the same way with `what="diaper"`.

**Longest-stretch delta** — give that card the delta computed in Step 1:
```tsx
          delta={stretchDelta >= 0.5 ? `+${stretchDelta.toFixed(1)}h` : undefined} good
```

- [ ] **Step 3: Full-tab loading / error states**

Refactor the screen's return into a shared `frame` so all three states share the header + scroll shell. Add after `body` is defined (replacing the existing `if (desktop) …` / `return <ScrollView>…` tail):
```tsx
  // Phone shows the inline header; desktop uses the shell's own top bar (as in growth.tsx).
  const head = (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2, paddingTop: 4, paddingBottom: 16 }}>
      <Txt weight={800} size={27} tracking={-0.6}>Insights</Txt>
      <Pressable onPress={openSwitcher} accessibilityRole="button" accessibilityLabel={child ? `${child.first}, switch child` : 'Switch child'} style={(s) => [{ cursor: 'pointer' }, isHovered(s) && { opacity: 0.85 }]}>
        <Avatar child={child} size={38} radius={12} fontSize={16} />
      </Pressable>
    </View>
  );
  const frame = (inner: ReactNode) =>
    desktop ? (
      <DesktopPage maxWidth={640}>{inner}</DesktopPage>
    ) : (
      <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: 24 }}>
        {head}
        {inner}
      </ScrollView>
    );

  if (!loaded) return frame(<CenteredState title="Loading insights…" subtitle="Gathering the last few weeks of sleep, feeds and diapers." />);
  if (error)
    return frame(
      <CenteredState
        title="Couldn't load insights"
        subtitle="Check your connection and try again."
        action={{ label: 'Try again', onPress: () => { useAppStore.setState({ insightsLoading: false }); loadInsights(); } }}
      />,
    );
  return frame(body);
```
(Delete the earlier `if (desktop) return <DesktopPage…>` / phone `return <ScrollView…>` block from Task 7 — `frame` now owns rendering. The `body` variable and its `onLayout` width measurement stay.)

- [ ] **Step 4: Verify**

Run: `npm run lint` → clean. Run: `npm test` → all suites PASS.
Manual:
- Demo (rich history): heatmap + all six charts populate; longest-stretch shows a green delta.
- Fresh/low-data child: heatmap and sparse charts show "Keep logging" placeholders, not broken axes.
- Simulate a load failure (e.g., temporarily bad token): the tab shows the error + Retry, no crash.
- Desktop shell: everything renders inside the sidebar layout at `maxWidth={640}`.

- [ ] **Step 5: Commit**

```bash
git add src/app/"(tabs)"/insights.tsx
git commit -m "feat(insights): loading, error, and low-data states"
```

---

## Final verification (before opening a PR)

- [ ] `npm test` — all vitest suites pass.
- [ ] `npm run lint` — clean.
- [ ] Manual pass on **phone** (demo + real server) and **desktop/web** per the spec's Testing section: heatmap reads correctly, range selector affects trends only, ⓘ sheets cite sources, diapers never sum, child switch reloads, low-data placeholders show.
- [ ] Use `superpowers:finishing-a-development-branch` to decide merge/PR.
