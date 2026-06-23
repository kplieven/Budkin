/**
 * Convert a #RRGGBB hex string to an rgba() string at the given alpha.
 * Ported verbatim from the design handoff reference (hexA).
 */
export function hexA(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
