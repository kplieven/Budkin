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
