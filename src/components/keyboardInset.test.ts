import { describe, expect, it } from 'vitest';

import { keyboardInset, nativeKeyboardHeight } from '@/components/keyboardInset';

describe('keyboardInset', () => {
  it('is 0 when no text field is focused, even if the viewport math is large', () => {
    // iOS Safari at rest: the large address bar (and any overscroll offset) leaves
    // innerHeight well above visualViewport.height, but there is no keyboard, so
    // the sheet must NOT lift.
    expect(keyboardInset(844, 600, 0, false)).toBe(0);
    expect(keyboardInset(844, 600, 44, false)).toBe(0);
  });

  it('measures the covered height when a text field is focused', () => {
    expect(keyboardInset(844, 500, 0, true)).toBe(344);
  });

  it('subtracts the browser pan (visualViewport.offsetTop) while a field is focused', () => {
    expect(keyboardInset(844, 500, 40, true)).toBe(304);
  });

  it('never returns a negative inset', () => {
    // The visual viewport can momentarily exceed innerHeight (URL bar collapsing).
    expect(keyboardInset(800, 810, 0, true)).toBe(0);
  });

  it('rounds sub-pixel viewport values', () => {
    expect(keyboardInset(844.5, 500.2, 0.1, true)).toBe(344);
  });
});

describe('nativeKeyboardHeight', () => {
  it('passes a normal keyboard height through', () => {
    expect(nativeKeyboardHeight(312)).toBe(312);
  });

  it('is 0 when the keyboard is closed', () => {
    expect(nativeKeyboardHeight(0)).toBe(0);
  });

  it('clamps a negative report to 0', () => {
    // Android reports imeInsets.bottom - systemBarInsets.bottom, which goes negative for
    // a floating IME shorter than the navigation bar it sits over. A negative padding
    // would pull the sheet DOWN, off the bottom of the screen.
    expect(nativeKeyboardHeight(-24)).toBe(0);
  });

  it('rounds sub-pixel heights', () => {
    expect(nativeKeyboardHeight(311.6)).toBe(312);
  });
});
