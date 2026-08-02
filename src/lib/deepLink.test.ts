import { describe, expect, it } from 'vitest';

import { childToSelectOnOpen, resolveTimerDeepLink, withChildParam } from '@/lib/deepLink';
import type { Child } from '@/types/models';

const child = (over: Partial<Child> = {}): Child => ({
  id: 'c1',
  first: 'Rowan',
  last: 'Doe',
  birth: new Date(2026, 1, 1).getTime(),
  color: '#EC9A66',
  ...over,
});

const rowan = child();
const wren = child({ id: 'c2', first: 'Wren' });
const roster = [rowan, wren];

describe('withChildParam', () => {
  it('names the child on a url that carries nothing yet', () => {
    expect(withChildParam('/timers', 'c2')).toBe('/timers?child=c2');
  });

  it('appends to a url that already carries a parameter', () => {
    expect(withChildParam('/log/medication?treatment=t1', 'c2')).toBe('/log/medication?treatment=t1&child=c2');
  });

  it('leaves the url alone when there is no child to name', () => {
    // The permanent case, not a transitional one: pumping reminders are
    // parent-side, launcher shortcuts are built before any child exists, and a
    // timer persisted before ownership was stamped has no owner to name.
    expect(withChildParam('/timers', undefined)).toBe('/timers');
    expect(withChildParam('/timers', '')).toBe('/timers');
  });

  it('encodes an id the query string would otherwise eat', () => {
    expect(withChildParam('/timers', 'a&b=c')).toBe('/timers?child=a%26b%3Dc');
  });
});

describe('childToSelectOnOpen', () => {
  it('selects the child a reminder names when someone else is selected', () => {
    expect(childToSelectOnOpen('/timers?child=c2', roster, 'c1')).toBe('c2');
  });

  it('selects nobody when the reminder names whoever is already selected', () => {
    // The common case: tapping the selected child's own nap nudge must not cost
    // a store write, a refetch and an insights reset.
    expect(childToSelectOnOpen('/timers?child=c1', roster, 'c1')).toBeUndefined();
  });

  it('selects nobody when the url names no child at all', () => {
    // Reminders scheduled by an older build keep their childless url for weeks:
    // neither diff compares `data`, so nothing reschedules them. This path is
    // permanent.
    expect(childToSelectOnOpen('/timers', roster, 'c1')).toBeUndefined();
    expect(childToSelectOnOpen('/', roster, 'c1')).toBeUndefined();
  });

  it('selects nobody when the named child no longer exists', () => {
    // A pending reminder outlives the child it names. Navigation-only
    // destinations just proceed against the current selection rather than
    // dead-ending.
    expect(childToSelectOnOpen('/history?child=gone', roster, 'c1')).toBeUndefined();
  });

  it('leaves write-adjacent destinations to their own route', () => {
    // `/log/<type>` and `/timer` resolve the parameter themselves, because they
    // have to REFUSE an unknown child rather than write against the wrong one.
    // Selecting for them here would also split behaviour by entry point: a
    // widget button never passes through this funnel.
    expect(childToSelectOnOpen('/log/feeding?child=c2', roster, 'c1')).toBeUndefined();
    expect(childToSelectOnOpen('/log/medication?treatment=t1&child=c2', roster, 'c1')).toBeUndefined();
    expect(childToSelectOnOpen('/timer?child=c2', roster, 'c1')).toBeUndefined();
  });

  it('does not mistake the Timers tab for the timer deep link', () => {
    expect(childToSelectOnOpen('/timers?child=c2', roster, 'c1')).toBe('c2');
  });

  it('reads back what withChildParam wrote, encoding and all', () => {
    const odd = child({ id: 'a&b=c', first: 'Odd' });
    expect(childToSelectOnOpen(withChildParam('/history', odd.id), [rowan, odd], 'c1')).toBe('a&b=c');
  });
});

describe('resolveTimerDeepLink', () => {
  const base = { child: undefined as string | undefined, connected: true, children: roster, selectedChildId: 'c1' };

  it('starts a timer for the current selection when the link names nobody', () => {
    expect(resolveTimerDeepLink(base)).toEqual({ kind: 'start', selectChildId: undefined });
  });

  it('selects the child the widget button names before starting', () => {
    // The widget's bitmap can be older than the selection it was rendered from,
    // so the button carries the child it is showing stats for.
    expect(resolveTimerDeepLink({ ...base, child: 'c2' })).toEqual({ kind: 'start', selectChildId: 'c2' });
  });

  it('selects nobody when the link names whoever is already selected', () => {
    expect(resolveTimerDeepLink({ ...base, child: 'c1' })).toEqual({ kind: 'start', selectChildId: undefined });
  });

  it('refuses when the named child no longer exists', () => {
    // Write-adjacent: starting a timer against the wrong child files a real
    // entry against them. Refuse rather than retarget.
    expect(resolveTimerDeepLink({ ...base, child: 'gone' })).toEqual({ kind: 'none' });
  });

  it('refuses when the named child is still expected, whoever is selected', () => {
    // Judged on the LINK's child, not the selection: a timer started for an
    // expecting child would log an activity against a due date.
    const expecting = child({ id: 'c3', first: 'Bean', expected: true });
    expect(resolveTimerDeepLink({ ...base, children: [...roster, expecting], child: 'c3' })).toEqual({ kind: 'none' });
  });

  it('refuses when the selected child is expected and the link names nobody', () => {
    const expecting = child({ id: 'c1', expected: true });
    expect(resolveTimerDeepLink({ ...base, children: [expecting, wren] })).toEqual({ kind: 'none' });
  });

  it('refuses when not connected', () => {
    expect(resolveTimerDeepLink({ ...base, connected: false, child: 'c2' })).toEqual({ kind: 'none' });
  });
});
