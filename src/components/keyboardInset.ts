/**
 * Pure geometry for BottomSheet's mobile-web keyboard lift. Kept free of
 * react-native imports so it's unit-testable in the node test env; the DOM
 * plumbing (visualViewport listeners, activeElement) lives in the component.
 */

/**
 * Does the currently focused element raise the on-screen keyboard? Only a
 * focused text-entry element does, and the soft keyboard cannot exist without
 * one. Everything else (buttons, the scrim, nothing focused) must leave the
 * sheet where it is.
 */
export function raisesKeyboard(el: Element | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(el instanceof HTMLElement)) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

/**
 * How far the mobile-web keyboard covers the layout viewport's bottom edge (the
 * amount to raise the sheet by). The keyboard only exists while a text field is
 * focused, so when none is (`textFieldFocused` false) the inset is 0 no matter
 * what the viewport reports: iOS Safari's at-rest gap between innerHeight and
 * visualViewport.height (large address bar, overscroll offsetTop, or a keyboard
 * caught mid-dismiss) must NOT lift the sheet. This semantic gate replaces the
 * old `covered > 120` magnitude threshold, which fought Safari's focus auto-pan
 * (the value dips under any threshold as offsetTop grows and the lift snapped
 * back with the keyboard still open).
 *
 * When a field IS focused, the covered height is the gap between the layout
 * viewport's bottom edge and the visible bottom edge (top of the keyboard):
 *   innerHeight - (visualViewport.offsetTop + visualViewport.height)
 * clamped at 0 (the visual viewport can briefly exceed innerHeight as the URL
 * bar collapses).
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
