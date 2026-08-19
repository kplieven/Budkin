/**
 * Pure geometry for BottomSheet's mobile-web keyboard lift. Kept free of
 * react-native imports so it's unit-testable in the node test env; the DOM plumbing
 * (visualViewport listeners, activeElement) lives in the component.
 */

/**
 * Does the currently focused element raise the on-screen keyboard? Only a focused
 * text-entry element does, and the soft keyboard cannot exist without one.
 */
export function raisesKeyboard(el: Element | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(el instanceof HTMLElement)) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

/**
 * How far the mobile-web keyboard covers the layout viewport's bottom edge.
 *
 * With no text field focused the inset is 0 whatever the viewport reports: iOS Safari's
 * at-rest gap between innerHeight and visualViewport.height must not lift the sheet. A
 * magnitude threshold cannot do this job, because the value dips under any threshold as
 * offsetTop grows and the lift then snaps back with the keyboard still open.
 *
 * Clamped at 0, since the visual viewport can briefly exceed innerHeight as the URL bar
 * collapses.
 */
export function keyboardInset(
  innerHeight: number,
  visualHeight: number,
  visualOffsetTop: number,
  textFieldFocused: boolean,
): number {
  if (!textFieldFocused) return 0;
  return Math.max(0, Math.round(innerHeight - visualHeight - visualOffsetTop));
}
