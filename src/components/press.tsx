import { useEffect, useRef, useState } from 'react';
import { Pressable, type PressableProps, type ViewStyle } from 'react-native';

/**
 * A Pressable that dims and shrinks while it is held, so a tap visibly lands.
 *
 * It does NOT use Pressable's own `pressed` state, which is too slow to be
 * believable: Pressability holds the pressed look for `DEFAULT_MIN_PRESS_DURATION`
 * (130ms) counted from touch-DOWN, so an ordinary 40ms tap keeps the button dimmed
 * for ~90ms after the finger has left the glass. That reads as lag, and it
 * compounds when you tap the same button repeatedly (a stepper, the day chevrons),
 * where the feedback visibly trails behind the hand.
 *
 * Instead the release comes from the raw touch events, which carry no delay of
 * their own, held only long enough to be seen. `onPressOut` is wired up as well:
 * it is the slow path (that same 130ms), but it is the one signal that always
 * arrives, so the button can never be left stuck in its pressed state — and on
 * web, where a mouse produces no touch events at all, it is the only release.
 */
export function Tappable({ style, onPressIn, onPressOut, onTouchEnd, onTouchCancel, ...rest }: PressableProps) {
  const [down, setDown] = useState(false);
  const downAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => clearTimeout(timer.current ?? undefined), []);

  const hold = () => {
    clearTimeout(timer.current ?? undefined);
    timer.current = null;
    downAt.current = Date.now();
    setDown(true);
  };

  // First release signal wins; the ones behind it find the timer already running.
  const lift = () => {
    if (timer.current) return;
    const left = MIN_VISIBLE_MS - (Date.now() - downAt.current);
    if (left <= 0) {
      setDown(false);
      return;
    }
    timer.current = setTimeout(() => {
      timer.current = null;
      setDown(false);
    }, left);
  };

  return (
    <Pressable
      {...rest}
      onPressIn={(e) => {
        hold();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        lift();
        onPressOut?.(e);
      }}
      onTouchEnd={(e) => {
        lift();
        onTouchEnd?.(e);
      }}
      onTouchCancel={(e) => {
        lift();
        onTouchCancel?.(e);
      }}
      style={(state) => [typeof style === 'function' ? style(state) : style, down && PRESSED]}
    />
  );
}

/**
 * How long the pressed look is guaranteed to stay up, counted from touch-down.
 * Some floor is needed or a fast tap would set and clear the state inside one
 * render batch and flash nothing at all — which is why Pressability has its own —
 * but 70ms is about the shortest a person still registers, where 130ms is long
 * enough to feel like the button is answering late.
 */
const MIN_VISIBLE_MS = 70;

const PRESSED: ViewStyle = { opacity: 0.65, transform: [{ scale: 0.97 }] };
