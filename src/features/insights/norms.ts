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
