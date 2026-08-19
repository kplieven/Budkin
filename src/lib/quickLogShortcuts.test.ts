/**
 * The launcher shortcuts (`plugins/quickLogShortcuts.js`) are build-time data: they
 * end up in an Android resource, so nothing in the app imports them and nothing would
 * notice them rotting. Rename an activity type or narrow the deep-link allowlist and
 * three launcher entries keep existing while quietly doing nothing.
 *
 * So this file tests the seam rather than the plugin: each shortcut's deep link is
 * walked back through the real resolver and must still land on a log sheet.
 */

import { describe, expect, it } from 'vitest';

import { ALL_ACTIVITIES } from '@/lib/activities';
import { resolveLogDeepLink } from '@/lib/logDeepLink';
import { activitySvg } from '@/widgets/widgetIcons';

import { QUICK_LOG_SHORTCUTS, shortcutDeepLink } from '../../plugins/quickLogShortcuts';

const READY = { treatment: undefined, connected: true, expected: false, selectedChildId: 'child-1', treatments: [] };

function activitySegment(url: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/log\/([^/?#]+)/.exec(url);
  if (!match) throw new Error(`not a log deep link: ${url}`);
  return match[1];
}

describe('quick log launcher shortcuts', () => {
  it('offers Feed, Diaper and Sleep, in that order', () => {
    expect(QUICK_LOG_SHORTCUTS.map((s) => s.shortLabel)).toEqual(['Feed', 'Diaper', 'Sleep']);
  });

  it.each(QUICK_LOG_SHORTCUTS)('$shortLabel opens a real log sheet', (shortcut) => {
    const url = shortcutDeepLink('budkin', shortcut);
    const type = activitySegment(url);

    expect(type).toBe(shortcut.activity);
    expect(ALL_ACTIVITIES).toContain(type);
    expect(resolveLogDeepLink({ ...READY, type })).toEqual({ kind: 'sheet', activity: type });
  });

  it('follows the variant scheme rather than hardcoding one', () => {
    // The development build ships `budkindev` so that, with both variants installed,
    // a shortcut cannot open the wrong app. See app.config.js.
    expect(shortcutDeepLink('budkindev', QUICK_LOG_SHORTCUTS[0])).toBe('budkindev://log/feeding');
  });

  it('has stable, unique shortcut and resource ids', () => {
    expect(QUICK_LOG_SHORTCUTS.map((s) => s.id)).toEqual(['log_feeding', 'log_diaper', 'log_sleep']);
    expect(new Set(QUICK_LOG_SHORTCUTS.map((s) => s.resourceName)).size).toBe(QUICK_LOG_SHORTCUTS.length);
  });

  it('keeps the labels inside what a launcher will show', () => {
    for (const shortcut of QUICK_LOG_SHORTCUTS) {
      // Android's guidance for a static shortcut: 10 characters short, 25 long.
      expect(shortcut.shortLabel.length).toBeLessThanOrEqual(10);
      expect(shortcut.longLabel.length).toBeLessThanOrEqual(25);
    }
  });

  it('draws the same glyphs as the widget buttons', () => {
    // The plugin has to be loadable by plain node at prebuild time, so it carries its
    // own copy of the path data instead of importing the widget's TypeScript.
    for (const shortcut of QUICK_LOG_SHORTCUTS) {
      const svg = activitySvg(shortcut.activity, '#000000');
      const paths = [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
      expect(shortcut.glyph).toEqual(paths);
    }
  });
});
