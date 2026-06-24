import { describe, expect, it } from 'vitest';

import {
  DESKTOP_MIN_WIDTH,
  RAIL_MIN_WIDTH,
  isDesktopWidth,
  showRail,
} from '@/shell/breakpoints';

describe('isDesktopWidth', () => {
  it('treats phone widths as not desktop', () => {
    expect(isDesktopWidth(390)).toBe(false);
    expect(isDesktopWidth(768)).toBe(false);
  });

  it('is false just below the desktop threshold', () => {
    expect(isDesktopWidth(DESKTOP_MIN_WIDTH - 1)).toBe(false);
  });

  it('is true at and above the desktop threshold (tablet landscape, laptop)', () => {
    expect(isDesktopWidth(DESKTOP_MIN_WIDTH)).toBe(true);
    expect(isDesktopWidth(1440)).toBe(true);
  });
});

describe('showRail', () => {
  it('is false on a narrow desktop where the timeline rail should collapse', () => {
    expect(showRail(DESKTOP_MIN_WIDTH)).toBe(false);
    expect(showRail(RAIL_MIN_WIDTH - 1)).toBe(false);
  });

  it('is true once there is room for the 372px rail', () => {
    expect(showRail(RAIL_MIN_WIDTH)).toBe(true);
    expect(showRail(1440)).toBe(true);
  });

  it('only shows the rail on desktop-width viewports', () => {
    expect(showRail(390)).toBe(false);
  });
});

describe('breakpoint constants', () => {
  it('orders the rail breakpoint above the desktop breakpoint', () => {
    expect(RAIL_MIN_WIDTH).toBeGreaterThan(DESKTOP_MIN_WIDTH);
  });
});
