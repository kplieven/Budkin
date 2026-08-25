import { describe, expect, it } from 'vitest';

import { treatmentCooldownLabel, treatmentScheduleLabel } from '@/features/treatments/treatmentLabels';
import type { Treatment } from '@/types/models';

const treatment = (over: Partial<Treatment> = {}): Treatment => ({
  id: 'treatment-1',
  childId: 'c1',
  name: 'Paracetamol',
  scheduleMode: 'timesOfDay',
  timesOfDay: ['morning', 'evening'],
  fromDate: new Date(2026, 2, 1).getTime(),
  active: true,
  ...over,
});

describe('treatmentScheduleLabel', () => {
  it('reads "As needed" for a sporadic treatment, regardless of the cooldown hours', () => {
    expect(treatmentScheduleLabel(treatment({ scheduleMode: 'sporadic', everyHours: 6, timesOfDay: undefined }))).toBe('As needed');
    expect(treatmentScheduleLabel(treatment({ scheduleMode: 'sporadic', everyHours: undefined, timesOfDay: undefined }))).toBe('As needed');
  });
});

describe('treatmentCooldownLabel', () => {
  const NOW = new Date(2026, 2, 4, 12, 0, 0).getTime();
  const M = 60000;

  it('is empty when not in cooldown', () => {
    expect(treatmentCooldownLabel({ inCooldown: false, readyAt: null }, NOW)).toBe('');
  });

  it('formats the remaining time until ready, rounded up to the minute', () => {
    expect(treatmentCooldownLabel({ inCooldown: true, readyAt: NOW + 200 * M }, NOW)).toBe('Can give again in 3h20m');
    expect(treatmentCooldownLabel({ inCooldown: true, readyAt: NOW + 30 * 1000 }, NOW)).toBe('Can give again in 1m');
  });
});
