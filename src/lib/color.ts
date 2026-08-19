import type { Child } from '@/types/models';

/** Convert a #RRGGBB hex string to an rgba() string at the given alpha. */
export function hexA(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Avatar tints for children, the single source of truth for `Child.color`.
 *  Hand-picked to read against `hexA(c, 0.32 | 0.22)` in both themes, so the list is
 *  not extended casually. Purely local: Baby Buddy has no color field. */
export const CHILD_COLORS = ['#EBA06A', '#9F94D4', '#6FC0A6', '#E6BE5E', '#EA958A'];

/** Pick the tint for a child being added to `existing`: the first one nobody wears,
 *  else the least-worn. Households of five or fewer come out collision-free, and
 *  unlike an index into the list it survives a deletion. Colors outside the palette
 *  are ignored rather than counted. */
export function nextChildColor(existing: Child[]): string {
  const used = new Map(CHILD_COLORS.map((c) => [c, 0]));
  for (const c of existing) {
    const n = used.get(c.color);
    if (n !== undefined) used.set(c.color, n + 1);
  }
  let best = CHILD_COLORS[0];
  let bestCount = Infinity;
  for (const c of CHILD_COLORS) {
    const n = used.get(c) ?? 0;
    if (n < bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return best;
}
