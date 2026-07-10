import { describe, expect, it } from 'vitest';

import { greetingFor, screenTitleFor } from '@/shell/labels';

describe('greetingFor', () => {
  it('greets by time of day per the web handoff', () => {
    expect(greetingFor(8)).toBe('Good morning');
    expect(greetingFor(14)).toBe('Good afternoon');
    expect(greetingFor(20)).toBe('Good evening');
  });

  it('handles the late-night / still-up edges', () => {
    expect(greetingFor(23)).toBe('Late night');
    expect(greetingFor(3)).toBe('Still up');
  });

  it('uses the right boundaries (noon, 5pm, 10pm, 5am)', () => {
    expect(greetingFor(11)).toBe('Good morning');
    expect(greetingFor(12)).toBe('Good afternoon');
    expect(greetingFor(16)).toBe('Good afternoon');
    expect(greetingFor(17)).toBe('Good evening');
    expect(greetingFor(21)).toBe('Good evening');
    expect(greetingFor(22)).toBe('Late night');
    expect(greetingFor(4)).toBe('Still up');
    expect(greetingFor(5)).toBe('Good morning');
  });
});

describe('screenTitleFor', () => {
  it('personalises the dashboard with the child first name', () => {
    expect(screenTitleFor('/', 'Mara')).toBe("Mara's day");
  });

  it('falls back to "Dashboard" when there is no child', () => {
    expect(screenTitleFor('/', undefined)).toBe('Dashboard');
  });

  it('titles the other routes', () => {
    expect(screenTitleFor('/timers', 'Mara')).toBe('Timers');
    expect(screenTitleFor('/history', 'Mara')).toBe('History');
    expect(screenTitleFor('/growth', 'Mara')).toBe('Growth');
    expect(screenTitleFor('/milestones', 'Mara')).toBe('Milestones');
    expect(screenTitleFor('/settings', 'Mara')).toBe('Settings');
  });

  it('falls back to the app name for unknown paths', () => {
    expect(screenTitleFor('/something-else', 'Mara')).toBe('Budkin');
  });

  it('titles the insights route', () => {
    expect(screenTitleFor('/insights')).toBe('Insights');
  });
});
