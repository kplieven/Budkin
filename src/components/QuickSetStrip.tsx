/**
 * The horizontal chip strip that LEADS a time panel, in the log sheet and on a running
 * timer's card alike.
 *
 * Order is load-bearing: with the strip below the exact editor, the panel handed you a
 * finished answer at the top, so the task ended before your eye reached the chips and the
 * anchors went unused.
 *
 * One line tall regardless of anchor count. When the chips overflow, the trailing one
 * peeks at the right edge as the "swipe for more" cue.
 */

import type { ReactNode } from 'react';
import { ScrollView } from 'react-native';

export function QuickSetStrip({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingRight: 4 }}
    >
      {children}
    </ScrollView>
  );
}
