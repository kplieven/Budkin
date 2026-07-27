import { describe, expect, it } from 'vitest';
import { phaseNoteFor } from './phase';

const DAY = 86400000;
const born = (days: number, now: number) => now - days * DAY;

describe('phaseNoteFor', () => {
  const now = new Date(2026, 6, 20, 12).getTime();

  it('shows the 4-month note inside the ~3.5–4.5 month window', () => {
    expect(phaseNoteFor(born(120, now), now)?.key).toBe('sleep4mo');
  });

  it('is silent before the window', () => {
    expect(phaseNoteFor(born(90, now), now)).toBeNull();
  });

  it('is silent after the window', () => {
    expect(phaseNoteFor(born(160, now), now)).toBeNull();
  });
});
