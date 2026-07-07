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
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  const fmtY = (v: number): string => v.toFixed(decimals);
  return { ticks, fmtY };
}

const DAY_MS = 86400000;
const fmtMonthDay = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const fmtMonth = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short' });
const fmtYear = (t: number) => String(new Date(t).getFullYear());

type XStep = { unit: 'day' | 'month'; n: number };
const X_STEPS: XStep[] = [
  { unit: 'day', n: 1 }, { unit: 'day', n: 2 }, { unit: 'day', n: 7 }, { unit: 'day', n: 14 },
  { unit: 'month', n: 1 }, { unit: 'month', n: 2 }, { unit: 'month', n: 3 }, { unit: 'month', n: 6 },
  { unit: 'month', n: 12 }, { unit: 'month', n: 24 }, { unit: 'month', n: 60 },
];

function genXTicks(tMin: number, tMax: number, step: XStep): number[] {
  const out: number[] = [];
  if (step.unit === 'day') {
    const d0 = new Date(tMin); d0.setHours(0, 0, 0, 0);
    const stepMs = step.n * DAY_MS;
    for (let ts = d0.getTime(); ts <= tMax; ts += stepMs) if (ts >= tMin) out.push(ts);
  } else {
    const d0 = new Date(tMin); d0.setDate(1); d0.setHours(0, 0, 0, 0);
    for (let k = 0; ; k++) {
      const d = new Date(d0.getFullYear(), d0.getMonth() + k * step.n, 1);
      const ts = d.getTime();
      if (ts > tMax) break;
      if (ts >= tMin) out.push(ts);
    }
  }
  return out;
}

/** Ascending, calendar-nice x-axis ticks within the data's time domain, bounded by a pixel budget. */
export function xTicksFor(points: TrendPoint[], maxTicks: number): { ticks: number[]; fmtX: (t: number) => string } {
  const budget = Math.max(2, Math.floor(maxTicks));
  if (points.length === 0) return { ticks: [], fmtX: fmtMonthDay };
  const tMin = points[0].t;
  const tMax = points[points.length - 1].t;
  if (points.length < 2 || tMax <= tMin) return { ticks: [tMin], fmtX: fmtMonthDay };

  const spanDays = (tMax - tMin) / DAY_MS;
  const fmtX = spanDays <= 62 ? fmtMonthDay : spanDays <= 730 ? fmtMonth : fmtYear;

  let ticks: number[] = [];
  for (const step of X_STEPS) {
    const t = genXTicks(tMin, tMax, step);
    if (t.length <= budget) { ticks = t; break; }
  }
  if (ticks.length < 2) ticks = [tMin, tMax];
  return { ticks, fmtX };
}

/** Change from the previous measurement to the latest, and the previous date. */
export function changeSince(points: TrendPoint[]): { delta: number; sinceT: number } | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  return { delta: last.value - prev.value, sinceT: prev.t };
}
