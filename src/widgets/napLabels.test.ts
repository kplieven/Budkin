import { describe, expect, it } from 'vitest';

import { napLabels } from '@/widgets/napLabels';

describe('napLabels with one child', () => {
  it('leaves the idle tile unnamed', () => {
    expect(napLabels({ childName: 'Ada', childCount: 1, napping: false })).toEqual({
      text: 'Start nap',
      accessibilityLabel: 'Start nap',
    });
  });

  it('leaves the napping tile unnamed', () => {
    expect(napLabels({ childName: 'Ada', childCount: 1, napping: true })).toEqual({
      text: '● Napping',
      accessibilityLabel: 'Stop nap',
    });
  });
});

describe('napLabels with a sibling', () => {
  it('names the child on the idle tile, visibly and to TalkBack', () => {
    expect(napLabels({ childName: 'Ada', childCount: 2, napping: false })).toEqual({
      text: 'Ada · Start nap',
      accessibilityLabel: 'Ada, start nap',
    });
  });

  it('names the child on the napping tile, visibly and to TalkBack', () => {
    expect(napLabels({ childName: 'Ada', childCount: 2, napping: true })).toEqual({
      text: '● Ada napping',
      accessibilityLabel: 'Ada, stop nap',
    });
  });

  it('names the child in a household of three', () => {
    expect(napLabels({ childName: 'Theo', childCount: 3, napping: false }).text).toBe('Theo · Start nap');
  });
});

describe('napLabels falls back to the unnamed tile', () => {
  // A snapshot written before `childCount` existed still parses as a v2 payload,
  // so the count arrives undefined until the app next writes. Degrading to the
  // unnamed tile is the safe direction: it says less, never something wrong.
  it('when the count is missing, even with a name', () => {
    expect(napLabels({ childName: 'Ada', childCount: undefined, napping: false }).text).toBe('Start nap');
    expect(napLabels({ childName: 'Ada', childCount: undefined, napping: true }).accessibilityLabel).toBe('Stop nap');
  });

  // `buildWidgetSnapshot` writes '' when no child matches the selected id.
  it('when the name is empty, on both branches', () => {
    expect(napLabels({ childName: '', childCount: 2, napping: false })).toEqual({
      text: 'Start nap',
      accessibilityLabel: 'Start nap',
    });
    expect(napLabels({ childName: '', childCount: 2, napping: true })).toEqual({
      text: '● Napping',
      accessibilityLabel: 'Stop nap',
    });
  });

  it('when there is no snapshot at all', () => {
    expect(napLabels({ childName: undefined, childCount: undefined, napping: false }).text).toBe('Start nap');
  });

  it('when the device holds no children', () => {
    expect(napLabels({ childName: '', childCount: 0, napping: false }).text).toBe('Start nap');
  });
});
