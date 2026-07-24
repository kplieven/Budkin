const DAY = 86400000;

/**
 * A gentle, expected-phase explainer for the Sleep section. This gives *meaning*
 * to what the heatmap already shows rather than adding another number.
 *
 * v1 covers only the ~4-month sleep change, and only from the baby's AGE — not
 * from any pattern-matching on the logs — so it can never false-positive on a
 * normal noisy week. Sleep fragmenting around now is a real, permanent shift in
 * sleep architecture, but it is framed as a common, expected phase (not a
 * guarantee, and not a regression to fix), matching the reassurance the rest of
 * the tab aims for.
 */

export interface PhaseNote { key: string; title: string; body: string }

// ~3.5–4.5 months. Wide enough to catch the window without implying a precise
// date the evidence does not support.
const FOUR_MONTH_FROM = 105;
const FOUR_MONTH_TO = 140;

export function phaseNoteFor(birthMs: number, now: number): PhaseNote | null {
  const ageDays = (now - birthMs) / DAY;
  if (ageDays >= FOUR_MONTH_FROM && ageDays <= FOUR_MONTH_TO) {
    return {
      key: 'sleep4mo',
      title: 'Around the 4-month sleep change',
      body: "Many babies' sleep gets more broken around now as it matures into more grown-up sleep cycles. Shorter stretches for a few weeks are a common, expected phase, not a step backwards.",
    };
  }
  return null;
}
