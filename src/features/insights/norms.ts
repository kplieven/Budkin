import type { TrendMetric } from './compute';

const DAY = 86400000;

export type NormKind = 'band' | 'floor' | 'ruleOfThumb' | 'none';
export interface NormBucket { maxAgeDays: number; lo: number; hi?: number }
export interface Norm {
  kind: NormKind;
  unit: string;
  buckets: NormBucket[];
  source: string;
  /** When present, the source is shown as a tappable link to the guidance. */
  sourceUrl?: string;
  disclaimer: string;
}

const DISCLAIMER = 'General guidance, not medical advice. Every baby is different, so speak to your doctor or paediatrician.';

// Sources documented inline. Bands are population ranges, deliberately wide.
export const NORMS: Record<TrendMetric | 'wet' | 'dirty', Norm> = {
  // WHO 2019 guideline on sleep for children under 5 (total sleep incl. naps);
  // a global independent body stating the same age-banded ranges the US bodies use.
  totalSleep: { kind: 'band', unit: 'h', source: 'World Health Organization',
    sourceUrl: 'https://www.who.int/publications/i/item/9789241550536', disclaimer: DISCLAIMER,
    buckets: [{ maxAgeDays: 90, lo: 14, hi: 17 }, { maxAgeDays: 365, lo: 12, hi: 16 }, { maxAgeDays: 730, lo: 11, hi: 14 }] },
  // NHS: newborns feed "at least 8 to 12 times every 24 hours"; feeds become
  // fewer and longer with age (later buckets taper that guidance).
  feedsPerDay: { kind: 'band', unit: '/day', source: 'NHS',
    sourceUrl: 'https://www.nhs.uk/baby/breastfeeding-and-bottle-feeding/breastfeeding/the-first-few-days/', disclaimer: DISCLAIMER,
    buckets: [{ maxAgeDays: 30, lo: 8, hi: 12 }, { maxAgeDays: 90, lo: 7, hi: 9 }, { maxAgeDays: 180, lo: 5, hi: 7 }, { maxAgeDays: 365, lo: 4, hi: 6 }] },
  // NHS: "6 or more wet nappies a day" from ~day 5 onward; the first days ramp
  // up (lower floor for <=5 days). Floor line, no upper bound.
  wet: { kind: 'floor', unit: '/day', source: 'NHS',
    sourceUrl: 'https://www.nhs.uk/baby/breastfeeding-and-bottle-feeding/breastfeeding-problems/enough-milk/', disclaimer: DISCLAIMER,
    buckets: [{ maxAgeDays: 5, lo: 4 }, { maxAgeDays: 3650, lo: 6 }] },
  // Sleep-consultant rules of thumb — independent guidance, NOT medical
  // consensus (no European or WHO body defines named "wake windows").
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
