import { describe, expect, it } from 'vitest';

import { MILESTONES, MILESTONE_BY_KEY, aroundNow, groupByCategory, reachedByKey } from '@/lib/milestones';
import type { Entry, MilestoneEntry } from '@/types/models';

function ms(key: string, time: number): MilestoneEntry {
  return { id: `e-${key}`, childId: '5', type: 'milestone', key, time, text: key, tags: [] };
}

describe('catalog integrity', () => {
  it('has unique keys and min <= max ranges', () => {
    const keys = MILESTONES.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const m of MILESTONES) expect(m.minMonths).toBeLessThanOrEqual(m.maxMonths);
  });

  it('indexes every def by key', () => {
    for (const m of MILESTONES) expect(MILESTONE_BY_KEY[m.key]).toBe(m);
  });
});

describe('reachedByKey', () => {
  it('maps keys to entries, earliest time wins on duplicates', () => {
    const entries: Entry[] = [ms('first-steps', 2000), ms('first-steps', 1000), ms('first-word', 5000)];
    const map = reachedByKey(entries);
    expect(map.size).toBe(2);
    expect(map.get('first-steps')?.time).toBe(1000);
  });

  it('ignores non-milestone entries', () => {
    const entries = [{ id: 'n', childId: '5', type: 'note', time: 1, text: 'x', tags: [] }] as Entry[];
    expect(reachedByKey(entries).size).toBe(0);
  });
});

describe('aroundNow', () => {
  const reached = reachedByKey([ms('rolls-over', 1)]);

  it('includes not-yet-reached defs whose range contains the age (inclusive bounds)', () => {
    // sits-unassisted is 5-8 months
    expect(aroundNow(5, reached).map((d) => d.key)).toContain('sits-unassisted');
    expect(aroundNow(8, reached).map((d) => d.key)).toContain('sits-unassisted');
  });

  it('excludes already-reached milestones', () => {
    // rolls-over is 4-6 months but already reached
    expect(aroundNow(5, reached).map((d) => d.key)).not.toContain('rolls-over');
  });

  it('returns empty when age is null', () => {
    expect(aroundNow(null, reached)).toEqual([]);
  });
});

describe('groupByCategory', () => {
  it('preserves category order and omits empty categories', () => {
    const subset = MILESTONES.filter((m) => m.key === 'first-steps' || m.key === 'first-word');
    const groups = groupByCategory(subset);
    expect(groups.map((g) => g.category)).toEqual(['Movement', 'Communication']);
    expect(groups[0].items.map((i) => i.key)).toEqual(['first-steps']);
  });
});
