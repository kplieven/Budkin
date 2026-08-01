import { describe, expect, it } from 'vitest';

import { normalizeWash } from '@/lib/wash';

describe('normalizeWash', () => {
  it('passes the current values through', () => {
    expect(normalizeWash('full')).toBe('full');
    expect(normalizeWash('quick')).toBe('quick');
  });

  it('maps the pre-2026-08 big/small values', () => {
    expect(normalizeWash('big')).toBe('full');
    expect(normalizeWash('small')).toBe('quick');
  });

  it('falls back to quick for anything unrecognised', () => {
    for (const v of [undefined, null, '', 'BIG', 'Full', 0, 1, {}, []]) {
      expect(normalizeWash(v)).toBe('quick');
    }
  });
});
