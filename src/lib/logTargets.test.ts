import { describe, expect, it } from 'vitest';

import { anchorChildId, eligibleTargetChildren, sheetTargetIds, targetChildrenLabel } from '@/lib/logTargets';
import type { Child } from '@/types/models';

const child = (id: string, first: string, extra: Partial<Child> = {}): Child => ({
  id,
  first,
  last: 'O',
  birth: 1_700_000_000_000 - 90 * 86400000,
  color: '#fff',
  ...extra,
});

const mira = child('c1', 'Mira');
const ivo = child('c2', 'Ivo');
const ada = child('c3', 'Ada');

describe('sheetTargetIds', () => {
  it('is the sheet\'s own list once it has one', () => {
    expect(sheetTargetIds(['c2'], 'c1')).toEqual(['c2']);
    expect(sheetTargetIds(['c1', 'c2'], 'c1')).toEqual(['c1', 'c2']);
  });

  it('falls back to the caller\'s child when the sheet carries no list', () => {
    expect(sheetTargetIds([], 'c1')).toEqual(['c1']);
  });
});

describe('anchorChildId', () => {
  it('is the single target, which is what the anchor chips are scoped to', () => {
    expect(anchorChildId(['c2'], 'c1')).toBe('c2');
    expect(anchorChildId([], 'c1')).toBe('c1');
  });

  it('is undefined with several targets, so the chips are suppressed', () => {
    // "Since last feed" has no single correct answer across two children, and
    // tapping a chip PERSISTS that timestamp onto the entry rather than only
    // displaying it. Offering one twin's last feed as the other's would save it
    // as fact, so there is nothing safe to offer.
    expect(anchorChildId(['c1', 'c2'], 'c1')).toBeUndefined();
  });
});

describe('eligibleTargetChildren', () => {
  it('drops expecting children', () => {
    // Logging against a due date is unreachable everywhere else in the app
    // (`resolveLogDeepLink` refuses it), and listing them here would be a new
    // entrance to it.
    const bump = child('c4', 'Bump', { expected: true });
    expect(eligibleTargetChildren([mira, bump, ivo]).map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('keeps the roster order', () => {
    expect(eligibleTargetChildren([ivo, mira]).map((c) => c.id)).toEqual(['c2', 'c1']);
  });
});

describe('targetChildrenLabel', () => {
  it('names one child', () => {
    expect(targetChildrenLabel([mira, ivo], ['c1'])).toBe('Mira');
  });

  it('joins two with "and"', () => {
    expect(targetChildrenLabel([mira, ivo], ['c1', 'c2'])).toBe('Mira and Ivo');
  });

  it('joins three with commas and a final "and"', () => {
    expect(targetChildrenLabel([mira, ivo, ada], ['c1', 'c2', 'c3'])).toBe('Mira, Ivo and Ada');
  });

  it('follows the target order, not the roster order', () => {
    expect(targetChildrenLabel([mira, ivo], ['c2', 'c1'])).toBe('Ivo and Mira');
  });

  it('is empty when nothing resolves, so the caller can hide the line', () => {
    expect(targetChildrenLabel([mira], [])).toBe('');
    expect(targetChildrenLabel([mira], ['gone'])).toBe('');
  });
});
