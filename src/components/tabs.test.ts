import { describe, expect, it } from 'vitest';

import { isTabName, TABS, TAB_NAMES, tabHref } from '@/components/tabs';

describe('tab metadata', () => {
  it('keeps Home first, since it is the group’s initial route', () => {
    expect(TAB_NAMES[0]).toBe('index');
  });

  it('sends every tab to its own route inside the group', () => {
    // The bar is rendered from OUTSIDE the tab navigator too (the Timers
    // screen), where a tap is a router.navigate rather than a tab jump. A href
    // that does not match its route name would quietly send that tab
    // somewhere else, and only from that one screen.
    for (const name of TAB_NAMES) {
      if (name === 'index') continue;
      expect(tabHref(name)).toBe(`/(tabs)/${name}`);
    }
  });

  it('sends Home to the group itself, not to an index path', () => {
    expect(tabHref('index')).toBe('/(tabs)');
  });

  it('recognises its own names and nothing else', () => {
    // The navigator hands back a plain route-name string. A route in the group
    // that is not in the bar (or no active route at all) must light nothing up,
    // rather than being forced into a name the table does not have.
    for (const name of TAB_NAMES) expect(isTabName(name)).toBe(true);
    expect(isTabName('timers')).toBe(false);
    expect(isTabName(undefined)).toBe(false);
    expect(isTabName(null)).toBe(false);
  });

  it('gives every tab a label and an icon', () => {
    for (const name of TAB_NAMES) {
      expect(TABS[name].label).toBeTruthy();
      expect(TABS[name].icon).toBeTruthy();
    }
  });
});
