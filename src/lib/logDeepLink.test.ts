import { describe, expect, it } from 'vitest';

import { resolveLogDeepLink } from '@/lib/logDeepLink';
import type { Cure } from '@/types/models';

const cure = (over: Partial<Cure> = {}): Cure => ({
  id: 'cure1',
  childId: 'c1',
  name: 'Omeprazol',
  scheduleMode: 'timesOfDay',
  timesOfDay: ['morning'],
  fromDate: new Date(2026, 8, 1).getTime(),
  active: true,
  ...over,
});

const base = { type: 'feeding', cure: undefined, connected: true, expected: false, cures: [] as Cure[] };

describe('resolveLogDeepLink', () => {
  it('opens the sheet for a plain activity', () => {
    expect(resolveLogDeepLink({ ...base, type: 'feeding' })).toEqual({ kind: 'sheet', activity: 'feeding' });
  });

  it('does nothing when not connected', () => {
    expect(resolveLogDeepLink({ ...base, connected: false })).toEqual({ kind: 'none' });
  });

  it('does nothing when the selected child is still expected', () => {
    // Logging against a due date rather than a birth date. Same guard the route
    // has always had, and the one timer.tsx mirrors.
    expect(resolveLogDeepLink({ ...base, expected: true })).toEqual({ kind: 'none' });
  });

  it('does nothing for an unknown activity', () => {
    expect(resolveLogDeepLink({ ...base, type: 'nonsense' })).toEqual({ kind: 'none' });
    expect(resolveLogDeepLink({ ...base, type: undefined })).toEqual({ kind: 'none' });
  });

  it('seeds the sheet from a cure the parameter names', () => {
    expect(
      resolveLogDeepLink({ ...base, type: 'medication', cure: 'cure1', cures: [cure()] }),
    ).toEqual({ kind: 'cure', cureId: 'cure1' });
  });

  it('opens the medication log when the parameter is absent', () => {
    expect(resolveLogDeepLink({ ...base, type: 'medication', cures: [cure()] })).toEqual({
      kind: 'medicationLog',
    });
  });

  it('falls back when the parameter names a cure that no longer exists', () => {
    // A pending notification outlives the cure it names: it can be deleted
    // between being scheduled and being tapped. logMedicationFromCure refuses an
    // unknown id and would open nothing at all.
    expect(
      resolveLogDeepLink({ ...base, type: 'medication', cure: 'gone', cures: [cure()] }),
    ).toEqual({ kind: 'medicationLog' });
  });

  it('falls back when the named cure has a blank name', () => {
    // logMedicationFromCure refuses this too, for the same reason save() does.
    expect(
      resolveLogDeepLink({ ...base, type: 'medication', cure: 'cure1', cures: [cure({ name: '  ' })] }),
    ).toEqual({ kind: 'medicationLog' });
  });

  it('falls back on a blank or whitespace-only parameter', () => {
    expect(
      resolveLogDeepLink({ ...base, type: 'medication', cure: '   ', cures: [cure()] }),
    ).toEqual({ kind: 'medicationLog' });
  });

  it('ignores a cure parameter on a non-medication activity', () => {
    expect(
      resolveLogDeepLink({ ...base, type: 'sleep', cure: 'cure1', cures: [cure()] }),
    ).toEqual({ kind: 'sheet', activity: 'sleep' });
  });

  it('still refuses everything when not connected, even with a valid cure', () => {
    expect(
      resolveLogDeepLink({ ...base, type: 'medication', cure: 'cure1', cures: [cure()], connected: false }),
    ).toEqual({ kind: 'none' });
  });
});
