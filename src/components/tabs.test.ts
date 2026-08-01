import { readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isTabName, TABS, TAB_NAMES } from '@/components/tabs';

const TABS_DIR = path.resolve(__dirname, '../app/(tabs)');

/** The route names the (tabs) group actually contains: every screen file and
 *  every nested directory in it, minus the layout itself. */
function routeNamesOnDisk(): string[] {
  return readdirSync(TABS_DIR, { withFileTypes: true })
    .filter((e) => e.name !== '_layout.tsx' && !e.name.endsWith('.test.ts'))
    .map((e) => (e.isDirectory() ? e.name : e.name.replace(/\.tsx?$/, '')))
    .sort();
}

describe('tab metadata', () => {
  it('has an entry for every route in the group, and no others', () => {
    // The bar renders from this table, not from the navigator's route list, so
    // a screen added to the group without a table entry would silently not
    // appear in the bar — and a table entry with no screen would render a tab
    // that navigates nowhere. This is the only thing keeping the two in step.
    expect([...TAB_NAMES].sort()).toEqual(routeNamesOnDisk());
  });

  it('keeps Home first, since it is the group’s initial route', () => {
    expect(TAB_NAMES[0]).toBe('(home)');
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
