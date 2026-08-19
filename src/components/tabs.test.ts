import { readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isTabName, TABS, TAB_NAMES } from '@/components/tabs';

const TABS_DIR = path.resolve(__dirname, '../app/(tabs)');

/** Every screen file and nested directory in the (tabs) group, minus the layout. */
function routeNamesOnDisk(): string[] {
  return readdirSync(TABS_DIR, { withFileTypes: true })
    .filter((e) => e.name !== '_layout.tsx' && !e.name.endsWith('.test.ts'))
    .map((e) => (e.isDirectory() ? e.name : e.name.replace(/\.tsx?$/, '')))
    .sort();
}

describe('tab metadata', () => {
  it('has an entry for every route in the group, and no others', () => {
    // The bar renders from this table, not from the navigator's route list, so a
    // screen with no table entry silently never appears in the bar, and a table
    // entry with no screen renders a tab that navigates nowhere.
    expect([...TAB_NAMES].sort()).toEqual(routeNamesOnDisk());
  });

  it('keeps Home first, since it is the group’s initial route', () => {
    expect(TAB_NAMES[0]).toBe('(home)');
  });

  it('recognises its own names and nothing else', () => {
    // The navigator hands back a plain route-name string, and a route outside the
    // bar (or no active route at all) must light nothing up.
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
