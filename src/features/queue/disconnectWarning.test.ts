import { describe, expect, it } from 'vitest';

import {
  changeCountLabel,
  DISCONNECT_BASE_LINE,
  disconnectLossLine,
} from '@/features/queue/disconnectWarning';

describe('changeCountLabel', () => {
  it('uses the singular for exactly one', () => {
    expect(changeCountLabel(1)).toBe('1 change');
  });

  it('uses the plural for none and for many', () => {
    expect(changeCountLabel(0)).toBe('0 changes');
    expect(changeCountLabel(4)).toBe('4 changes');
  });
});

describe('DISCONNECT_BASE_LINE', () => {
  it('never claims a loss', () => {
    // The base sentence shows on EVERY open. The loss claim belongs to
    // disconnectLossLine alone, which is null when nothing would be lost, so a "lost"
    // here would cry wolf on every empty disconnect.
    expect(DISCONNECT_BASE_LINE.toLowerCase()).not.toContain('lost');
  });

  it('says what a disconnect does to this device', () => {
    expect(DISCONNECT_BASE_LINE).toContain('signs you out');
    expect(DISCONNECT_BASE_LINE).toContain('this device');
  });
});

describe('disconnectLossLine', () => {
  it('is null when nothing would be lost', () => {
    expect(disconnectLossLine(0, 0)).toBeNull();
  });

  it('counts queued entries alone, singular and plural', () => {
    expect(disconnectLossLine(3, 0)).toBe('3 entries waiting to upload will be permanently lost.');
    expect(disconnectLossLine(1, 0)).toBe('1 entry waiting to upload will be permanently lost.');
  });

  it('counts offline changes alone, singular and plural', () => {
    expect(disconnectLossLine(0, 2)).toBe('2 changes waiting to upload will be permanently lost.');
    expect(disconnectLossLine(0, 1)).toBe('1 change waiting to upload will be permanently lost.');
  });

  it('names both populations when both exist', () => {
    expect(disconnectLossLine(3, 2)).toBe(
      '3 entries and 2 changes waiting to upload will be permanently lost.',
    );
    expect(disconnectLossLine(1, 1)).toBe(
      '1 entry and 1 change waiting to upload will be permanently lost.',
    );
  });

  it('says the loss is permanent, in every shape', () => {
    // The whole point of the confirm: disconnect() clears the queue and the op-log,
    // and they exist nowhere else.
    for (const line of [disconnectLossLine(2, 0), disconnectLossLine(0, 2), disconnectLossLine(2, 2)]) {
      expect(line).toContain('permanently lost');
    }
  });
});
