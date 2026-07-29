import { describe, expect, it } from 'vitest';

import { resolveLogDeepLink } from '@/lib/logDeepLink';
import type { Treatment } from '@/types/models';

const treatment = (over: Partial<Treatment> = {}): Treatment => ({
  id: 'treatment1',
  childId: 'c1',
  name: 'Omeprazol',
  scheduleMode: 'timesOfDay',
  timesOfDay: ['morning'],
  fromDate: new Date(2026, 8, 1).getTime(),
  active: true,
  ...over,
});

const base = {
  type: 'feeding',
  treatment: undefined,
  connected: true,
  expected: false,
  selectedChildId: 'c1',
  treatments: [] as Treatment[],
};

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

  it('seeds the sheet from a treatment the parameter names', () => {
    expect(
      resolveLogDeepLink({ ...base, type: 'medication', treatment: 'treatment1', treatments: [treatment()] }),
    ).toEqual({ kind: 'treatment', treatmentId: 'treatment1' });
  });

  it('opens the medication log when the parameter is absent', () => {
    expect(resolveLogDeepLink({ ...base, type: 'medication', treatments: [treatment()] })).toEqual({
      kind: 'medicationLog',
    });
  });

  it('falls back when the parameter names a treatment that no longer exists', () => {
    // A pending notification outlives the treatment it names: it can be deleted
    // between being scheduled and being tapped. logMedicationFromTreatment refuses an
    // unknown id and would open nothing at all.
    expect(
      resolveLogDeepLink({ ...base, type: 'medication', treatment: 'gone', treatments: [treatment()] }),
    ).toEqual({ kind: 'medicationLog' });
  });

  it('falls back when the named treatment belongs to a child other than the one selected', () => {
    // A delivered notification can outlive a child switch: the pending alert for
    // child A stays in the tray after the parent switches to child B, and
    // tapping it must not seed the sheet with A's treatment while the app is headed
    // for B. Falls back to the picker exactly like an unknown treatment.
    expect(
      resolveLogDeepLink({
        ...base,
        type: 'medication',
        treatment: 'treatment1',
        treatments: [treatment()],
        selectedChildId: 'c2',
      }),
    ).toEqual({ kind: 'medicationLog' });
  });

  it('falls back when the named treatment has a blank name', () => {
    // logMedicationFromTreatment refuses this too, for the same reason save() does.
    expect(
      resolveLogDeepLink({ ...base, type: 'medication', treatment: 'treatment1', treatments: [treatment({ name: '  ' })] }),
    ).toEqual({ kind: 'medicationLog' });
  });

  it('falls back on a blank or whitespace-only parameter', () => {
    expect(
      resolveLogDeepLink({ ...base, type: 'medication', treatment: '   ', treatments: [treatment()] }),
    ).toEqual({ kind: 'medicationLog' });
  });

  it('ignores a treatment parameter on a non-medication activity', () => {
    expect(
      resolveLogDeepLink({ ...base, type: 'sleep', treatment: 'treatment1', treatments: [treatment()] }),
    ).toEqual({ kind: 'sheet', activity: 'sleep' });
  });

  it('still refuses everything when not connected, even with a valid treatment', () => {
    expect(
      resolveLogDeepLink({ ...base, type: 'medication', treatment: 'treatment1', treatments: [treatment()], connected: false }),
    ).toEqual({ kind: 'none' });
  });
});
