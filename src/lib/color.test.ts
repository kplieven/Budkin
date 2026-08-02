import { describe, expect, it } from 'vitest';

import { CHILD_COLORS, hexA, nextChildColor } from '@/lib/color';
import type { Child } from '@/types/models';

const kid = (color: string): Child => ({ id: color, first: 'A', last: '', birth: 0, color });

describe('hexA', () => {
  it('splits #RRGGBB into an rgba() string at the given alpha', () => {
    expect(hexA('#EBA06A', 0.32)).toBe('rgba(235,160,106,0.32)');
    expect(hexA('#000000', 1)).toBe('rgba(0,0,0,1)');
  });
});

describe('nextChildColor', () => {
  it('gives the first child the first tint in the palette', () => {
    expect(nextChildColor([])).toBe(CHILD_COLORS[0]);
  });

  it('walks the palette in order while tints are still free', () => {
    expect(nextChildColor([kid(CHILD_COLORS[0])])).toBe(CHILD_COLORS[1]);
    expect(nextChildColor([kid(CHILD_COLORS[0]), kid(CHILD_COLORS[1])])).toBe(CHILD_COLORS[2]);
  });

  it('reuses the tint a deleted sibling freed rather than counting the list', () => {
    // Exactly the shape left by deleting the middle of three children. Picking
    // by list length here would hand out a tint already on screen.
    expect(nextChildColor([kid(CHILD_COLORS[0]), kid(CHILD_COLORS[2])])).toBe(CHILD_COLORS[1]);
  });

  it('order of the existing children does not change the answer', () => {
    expect(nextChildColor([kid(CHILD_COLORS[2]), kid(CHILD_COLORS[0])])).toBe(CHILD_COLORS[1]);
  });

  it('falls back to the least-used tint once every one is taken', () => {
    const all = CHILD_COLORS.map((c) => kid(c));
    expect(nextChildColor(all)).toBe(CHILD_COLORS[0]);
    expect(nextChildColor([...all, kid(CHILD_COLORS[0])])).toBe(CHILD_COLORS[1]);
  });

  it('ignores tints that are not in the palette', () => {
    // Demo-seed and pre-palette children must not steal a slot they cannot own.
    expect(nextChildColor([kid('#123456')])).toBe(CHILD_COLORS[0]);
  });
});
