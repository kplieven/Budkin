import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { pageFromOffset } from '@/features/walkthrough/pager';
import { WALKTHROUGH_SLIDES } from '@/features/walkthrough/slides';
import { useWebPaging } from '@/features/walkthrough/useWebPaging';
import { hexA } from '@/lib/color';
import { shadowStyle } from '@/theme/shadow';
import { useTheme } from '@/theme/useTheme';

/**
 * First-run intro carousel. Five swipeable slides (horizontal paging ScrollView),
 * a page-dot indicator, a Skip control (all but the last slide), and a primary
 * button that reads Next until the last slide, where it becomes Get started.
 * Presentational: the caller owns what "done" means (persist + navigate).
 */
export function Walkthrough({ onDone }: { onDone: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  // Measured pager box (width <= maxWidth, plus height). Slides are sized to this
  // so paging snaps cleanly on phone and a constrained desktop column, and the
  // explicit height lets each slide center its content vertically (a horizontal
  // paging ScrollView does not reliably stretch its children to full height on web).
  const [size, setSize] = useState({ w: 0, h: 0 });
  const scrollRef = useRef<ScrollView | null>(null);

  const last = index >= WALKTHROUGH_SLIDES.length - 1;

  const goTo = (i: number) => {
    const clamped = Math.max(0, Math.min(WALKTHROUGH_SLIDES.length - 1, i));
    setIndex(clamped);
    scrollRef.current?.scrollTo({ x: clamped * size.w, animated: true });
  };

  const next = () => {
    if (last) onDone();
    else goTo(index + 1);
  };

  // Wheel, trackpad and touch all move one slide at a time, forwards or back.
  // A 0 step is a gesture that fell short, which settles back onto `index`.
  useWebPaging(scrollRef, WALKTHROUGH_SLIDES.length, (delta) => goTo(index + delta), size.w > 0);

  // Native only: react-native-web never fires the momentum callbacks, so on web
  // `index` is authoritative and every gesture arrives through `useWebPaging`.
  // Deriving it from the scroll offset there would double-count a drag, which
  // already moved the deck one page before the release commits the turn.
  const syncIndex = (offsetX: number) =>
    setIndex(pageFromOffset(offsetX, size.w, WALKTHROUGH_SLIDES.length));

  // Re-measuring (first layout, or a resize) leaves the old pixel offset pointing
  // at the wrong slide, which `syncIndex` would then read as a page change.
  const indexRef = useRef(index);
  useEffect(() => {
    indexRef.current = index;
  });
  useEffect(() => {
    if (size.w > 0) scrollRef.current?.scrollTo({ x: indexRef.current * size.w, animated: false });
  }, [size.w]);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      {/* Skip (hidden on the last slide, where the primary button dismisses) */}
      <View style={{ height: 48, justifyContent: 'center', alignItems: 'flex-end', paddingHorizontal: 20 }}>
        {!last && (
          <Pressable
            onPress={onDone}
            accessibilityRole="button"
            accessibilityLabel="Skip"
            style={(s) => [{ paddingVertical: 8, paddingHorizontal: 6, cursor: 'pointer' }, isHovered(s) && { opacity: 0.7 }]}
          >
            <Txt unselectable weight={600} size={15} color={t.dim}>
              Skip
            </Txt>
          </Pressable>
        )}
      </View>

      {/* pager: centered, max-width column so it is not full-bleed on desktop */}
      <View
        style={{ flex: 1, alignSelf: 'center', width: '100%', maxWidth: 460 }}
        onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      >
        {size.w > 0 && (
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onMomentumScrollEnd={(e) => syncIndex(e.nativeEvent.contentOffset.x)}
          >
            {WALKTHROUGH_SLIDES.map((slide) => (
              // Each slide is sized to the measured pager box (width + height) so
              // its content centers vertically and paging snaps to full pages.
              <View key={slide.headline} style={{ width: size.w, height: size.h, paddingHorizontal: 32, alignItems: 'center', justifyContent: 'center' }}>
                <View
                  style={{
                    width: 96,
                    height: 96,
                    borderRadius: 30,
                    backgroundColor: hexA(t.primary, t.dark ? 0.16 : 0.12),
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name={slide.icon} color={t.primary} size={44} />
                </View>
                <Txt weight={800} size={26} tracking={-0.5} style={{ textAlign: 'center', marginTop: 28, lineHeight: 32 }}>
                  {slide.headline}
                </Txt>
                <Txt weight={500} size={15.5} color={t.dim} style={{ textAlign: 'center', marginTop: 12, lineHeight: 23 }}>
                  {slide.body}
                </Txt>
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      {/* page dots (active dot widens) */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 8, marginBottom: 20 }}>
        {WALKTHROUGH_SLIDES.map((slide, i) => (
          <View
            key={slide.headline}
            style={{
              width: i === index ? 22 : 8,
              height: 8,
              borderRadius: 99,
              backgroundColor: i === index ? t.primary : t.line2,
            }}
          />
        ))}
      </View>

      {/* primary button */}
      <View style={{ paddingHorizontal: 24, paddingBottom: 8 }}>
        <Pressable
          onPress={next}
          accessibilityRole="button"
          accessibilityLabel={last ? 'Get started' : 'Next'}
          style={(s) => [
            {
              height: 56,
              borderRadius: 17,
              backgroundColor: t.primary,
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            },
            shadowStyle(`0px 8px 22px ${hexA(t.primary, 0.35)}`),
            isHovered(s) && { opacity: 0.9 },
          ]}
        >
          <Txt unselectable weight={800} size={17} color={t.onPrimary}>
            {last ? 'Get started' : 'Next'}
          </Txt>
        </Pressable>
      </View>
    </View>
  );
}
