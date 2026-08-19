import { describe, expect, it } from 'vitest';

import { resolveLogDeepLink } from '@/lib/logDeepLink';
import type { Child, Treatment } from '@/types/models';

const child = (over: Partial<Child> = {}): Child => ({
  id: 'c1',
  first: 'Rowan',
  last: 'Doe',
  birth: new Date(2026, 1, 1).getTime(),
  color: '#EC9A66',
  ...over,
});

const wren = child({ id: 'c2', first: 'Wren' });

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
  child: undefined as string | undefined,
  connected: true,
  expected: false,
  selectedChildId: 'c1',
  children: [child(), wren],
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
    // Logging against a due date rather than a birth date.
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
    // between being scheduled and being tapped, and logMedicationFromTreatment
    // refuses an unknown id, so it would open nothing at all.
    expect(
      resolveLogDeepLink({ ...base, type: 'medication', treatment: 'gone', treatments: [treatment()] }),
    ).toEqual({ kind: 'medicationLog' });
  });

  it('falls back when a link naming no child names a treatment belonging to someone else', () => {
    // A delivered notification outlives a child switch: A's alert stays in the tray
    // after the parent switches to B, and tapping it must not seed the sheet with A's
    // treatment while the app is headed for B. Permanently reachable, too: a reminder
    // scheduled by a build predating `?child=` keeps its childless url until its
    // identifier moves, and `diffScheduled` compares identifier, title and body only.
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

  it('selects the treatment\'s own child when the link names them, and honours the treatment', () => {
    // Same tray-outlives-a-switch situation, but the alert says who it is for: the
    // dose belongs to c1, so select c1 rather than dropping the parent into c2's picker.
    expect(
      resolveLogDeepLink({
        ...base,
        type: 'medication',
        treatment: 'treatment1',
        child: 'c1',
        treatments: [treatment()],
        selectedChildId: 'c2',
      }),
    ).toEqual({ kind: 'treatment', treatmentId: 'treatment1', selectChildId: 'c1' });
  });

  it('selects the child a widget button names before opening the sheet', () => {
    // The widget's bitmap can be older than the selection it was rendered from,
    // so its buttons carry the child whose stats they sit under.
    expect(resolveLogDeepLink({ ...base, child: 'c2' })).toEqual({
      kind: 'sheet',
      activity: 'feeding',
      selectChildId: 'c2',
    });
  });

  it('selects nobody when the link names whoever is already selected', () => {
    // A store write here would cost a refetch and an insights reset for nothing.
    expect(resolveLogDeepLink({ ...base, child: 'c1' })).toEqual({
      kind: 'sheet',
      activity: 'feeding',
      selectChildId: undefined,
    });
  });

  it('refuses a link naming a child we no longer have', () => {
    // Unlike a navigation-only reminder, which proceeds against the current selection,
    // this one opens a write surface. Silently retargeting it is the bug, so refuse.
    expect(resolveLogDeepLink({ ...base, child: 'gone' })).toEqual({ kind: 'none' });
  });

  it('refuses when the child the link names is expected, whoever is selected', () => {
    // Judged on the LINK's child: `expected` describes the selected child, who is
    // not the one this would log against.
    const bean = child({ id: 'c3', first: 'Bean', expected: true });
    expect(resolveLogDeepLink({ ...base, child: 'c3', children: [...base.children, bean] })).toEqual({ kind: 'none' });
  });

  it('falls back when the named treatment has a blank name', () => {
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
